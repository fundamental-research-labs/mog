//! Formula accuracy regression tests for MATCH error cascading (Issue #2)
//! and INDEX/MATCH with array-formula IF (Issue #4).
//!
//! Issue #2: MATCH errors cascade through arithmetic, producing #DIV/0! or #N/A
//! when Excel expects valid numeric results. Root cause: upstream MATCH formulas
//! fail, and those errors propagate through dependent arithmetic.
//!
//! Issue #4: `IFERROR(INDEX(C:C, MATCH(LARGE(IF(Q="Closed", K), 1), K:K, 0)), "--")`
//! falls to the error branch instead of finding the correct value. Root cause:
//! MATCH receives an array argument from IF but IF doesn't evaluate in array
//! context (CSE-style) — it short-circuits to scalar.
//!
//! Run:
//!   cd os && cargo test -p compute-core --test formula_accuracy_match_index -- --nocapture

use cell_types::SheetPos;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET1_UUID: &str = "10000000000000000000000000000001";
const SHEET2_UUID: &str = "10000000000000000000000000000002";

/// Generate a deterministic cell UUID from row and col.
fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!(
        "{:08x}0000{:04x}0000{:012x}",
        0x20000000 + sheet_idx,
        col,
        row as u64
    )
}

/// Build a CellData with a static value (no formula).
fn val_cell(sheet_idx: u32, row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// Build a CellData with a formula.
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

/// Initialize ComputeCore from a snapshot and return it along with the recalc result.
fn init_core(snapshot: WorkbookSnapshot) -> (CellMirror, ComputeCore, compute_core::RecalcResult) {
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");
    (mirror, core, result)
}

/// Look up a cell value in the mirror by sheet UUID, row, col.
fn mirror_value(mirror: &CellMirror, sheet_uuid: &str, row: u32, col: u32) -> CellValue {
    let sheet_id = compute_core::SheetId::from_uuid_str(sheet_uuid).unwrap();
    mirror
        .get_cell_value_at(&sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

// ===========================================================================
// Issue #2: MATCH Error Cascading
// ===========================================================================

/// Test 1: Basic MATCH with exact match (match_type=0) finds correct position.
#[test]
fn test_match_exact_basic() {
    // Sheet layout:
    //   A0: "Alpha"   B0: 100
    //   A1: "Beta"    B1: 200
    //   A2: "Gamma"   B2: 300
    //   A3: "Delta"   B3: 400
    //   C0: =MATCH("Beta", A0:A3, 0)   -> expected: 2
    //   C1: =MATCH("Gamma", A0:A3, 0)  -> expected: 3
    //   C2: =MATCH("Missing", A0:A3, 0) -> expected: #N/A
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 2, 0, CellValue::Text("Gamma".into())),
        val_cell(1, 3, 0, CellValue::Text("Delta".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        val_cell(1, 2, 1, CellValue::number(300.0)),
        val_cell(1, 3, 1, CellValue::number(400.0)),
        formula_cell(1, 0, 2, "MATCH(\"Beta\",A1:A4,0)"),
        formula_cell(1, 1, 2, "MATCH(\"Gamma\",A1:A4,0)"),
        formula_cell(1, 2, 2, "MATCH(\"Missing\",A1:A4,0)"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 3,
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

    let (mirror, core, _result) = init_core(snapshot);

    let match_beta = mirror_value(&mirror, SHEET1_UUID, 0, 2);
    assert_eq!(
        match_beta,
        CellValue::number(2.0),
        "MATCH('Beta') should return 2"
    );

    let match_gamma = mirror_value(&mirror, SHEET1_UUID, 1, 2);
    assert_eq!(
        match_gamma,
        CellValue::number(3.0),
        "MATCH('Gamma') should return 3"
    );

    let match_missing = mirror_value(&mirror, SHEET1_UUID, 2, 2);
    assert_eq!(
        match_missing,
        CellValue::Error(CellError::Na, None),
        "MATCH('Missing') should return #N/A"
    );
}

/// Test 2: When the lookup value is an error, MATCH should propagate that error.
#[test]
fn test_match_error_in_lookup_value() {
    // A0: =1/0  (produces #DIV/0!)
    // B0: 10   B1: 20   B2: 30
    // C0: =MATCH(A1, B1:B3, 0)  -> should propagate #DIV/0!
    let cells = vec![
        formula_cell(1, 0, 0, "1/0"),
        val_cell(1, 0, 1, CellValue::number(10.0)),
        val_cell(1, 1, 1, CellValue::number(20.0)),
        val_cell(1, 2, 1, CellValue::number(30.0)),
        formula_cell(1, 0, 2, "MATCH(A1,B1:B3,0)"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 3,
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

    let (mirror, core, _result) = init_core(snapshot);

    let div0_val = mirror_value(&mirror, SHEET1_UUID, 0, 0);
    assert_eq!(
        div0_val,
        CellValue::Error(CellError::Div0, None),
        "A0 should be #DIV/0!"
    );

    let match_val = mirror_value(&mirror, SHEET1_UUID, 0, 2);
    assert_eq!(
        match_val,
        CellValue::Error(CellError::Div0, None),
        "MATCH with #DIV/0! lookup should propagate #DIV/0!"
    );
}

/// Test 3: MATCH returns #N/A when value isn't found.
#[test]
fn test_match_not_found_returns_na() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 1, 0, CellValue::number(20.0)),
        val_cell(1, 2, 0, CellValue::number(30.0)),
        formula_cell(1, 0, 1, "MATCH(99,A1:A3,0)"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 2,
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

    let (mirror, core, _result) = init_core(snapshot);

    let val = mirror_value(&mirror, SHEET1_UUID, 0, 1);
    assert_eq!(
        val,
        CellValue::Error(CellError::Na, None),
        "MATCH(99,...) should return #N/A"
    );
}

/// Test 4: #N/A from MATCH cascades through arithmetic.
/// This reproduces Issue #2: `D22+D23` produces #N/A because dependent cells
/// contain MATCH errors.
///
/// Setup:
///   A0: =MATCH("Missing", B1:B3, 0)  -> #N/A
///   C0: =A1+1                         -> should be #N/A (error propagation through +)
///   C1: =A1*2                         -> should be #N/A
///   C2: =100/A1                       -> should be #N/A (not #DIV/0!)
#[test]
fn test_match_na_cascades_through_arithmetic() {
    let cells = vec![
        val_cell(1, 0, 1, CellValue::Text("X".into())),
        val_cell(1, 1, 1, CellValue::Text("Y".into())),
        val_cell(1, 2, 1, CellValue::Text("Z".into())),
        formula_cell(1, 0, 0, "MATCH(\"Missing\",B1:B3,0)"),
        formula_cell(1, 0, 2, "A1+1"),
        formula_cell(1, 1, 2, "A1*2"),
        formula_cell(1, 2, 2, "100/A1"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 3,
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

    let (mirror, core, _result) = init_core(snapshot);

    let match_val = mirror_value(&mirror, SHEET1_UUID, 0, 0);
    assert_eq!(
        match_val,
        CellValue::Error(CellError::Na, None),
        "A0: MATCH should be #N/A"
    );

    let add_val = mirror_value(&mirror, SHEET1_UUID, 0, 2);
    assert_eq!(
        add_val,
        CellValue::Error(CellError::Na, None),
        "C0: #N/A + 1 should propagate #N/A, not produce a different error"
    );

    let mul_val = mirror_value(&mirror, SHEET1_UUID, 1, 2);
    assert_eq!(
        mul_val,
        CellValue::Error(CellError::Na, None),
        "C1: #N/A * 2 should propagate #N/A"
    );

    let div_val = mirror_value(&mirror, SHEET1_UUID, 2, 2);
    assert_eq!(
        div_val,
        CellValue::Error(CellError::Na, None),
        "C2: 100 / #N/A should propagate #N/A, not #DIV/0!"
    );
}

/// Test 5: INDEX(range, MATCH(...)) where MATCH fails returns #N/A, not #REF!.
/// This tests the error cascade through INDEX.
#[test]
fn test_index_match_error_cascade() {
    // A0: "Alpha"  B0: 100
    // A1: "Beta"   B1: 200
    // C0: =INDEX(B1:B2, MATCH("Missing", A1:A2, 0))  -> #N/A (from MATCH, not #REF! from INDEX)
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        formula_cell(1, 0, 2, "INDEX(B1:B2,MATCH(\"Missing\",A1:A2,0))"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 2,
            cols: 3,
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

    let (mirror, core, _result) = init_core(snapshot);

    let val = mirror_value(&mirror, SHEET1_UUID, 0, 2);
    assert_eq!(
        val,
        CellValue::Error(CellError::Na, None),
        "INDEX(range, MATCH(missing)) should be #N/A, not #REF!"
    );
}

/// Test 5b: INDEX/MATCH with successful match returns correct value.
///
/// BUG DISCOVERED: INDEX(B1:B3, 2) returns #REF! instead of 200.
/// MATCH correctly returns 2, but INDEX fails to retrieve the value from the range.
/// This is a contributing factor to Issue #2's 2,440+ errors — even when MATCH
/// succeeds, the INDEX step can produce #REF! which then cascades.
///
/// CORRECT BEHAVIOR: INDEX(B1:B3, MATCH("Beta", A1:A3, 0)) = INDEX(B1:B3, 2) = 200
/// ACTUAL BUG: Returns #REF!
#[test]
fn test_index_match_success() {
    // A0: "Alpha"  B0: 100
    // A1: "Beta"   B1: 200
    // A2: "Gamma"  B2: 300
    // C0: =INDEX(B1:B3, MATCH("Beta", A1:A3, 0))  -> expected: 200
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 2, 0, CellValue::Text("Gamma".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        val_cell(1, 2, 1, CellValue::number(300.0)),
        formula_cell(1, 0, 2, "INDEX(B1:B3,MATCH(\"Beta\",A1:A3,0))"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 3,
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

    let (mirror, core, _result) = init_core(snapshot);

    let val = mirror_value(&mirror, SHEET1_UUID, 0, 2);

    assert_eq!(
        val,
        CellValue::number(200.0),
        "INDEX(B1:B3, MATCH('Beta', A1:A3, 0)) should return 200"
    );
}

/// Test 5c: Multi-step error cascade: MATCH -> INDEX -> arithmetic.
/// Reproduces the Issue #2 pattern: (P19-D19)/D19/J19 yields #DIV/0! because
/// upstream cells resolve to MATCH errors.
#[test]
fn test_multi_step_error_cascade_match_to_arithmetic() {
    // A0: "Alpha"  B0: 100
    // A1: "Beta"   B1: 200
    //
    // D0 (col 3): =INDEX(B1:B2, MATCH("NotFound", A1:A2, 0))  -> #N/A
    // E0 (col 4): =D1-100                                       -> #N/A
    // F0 (col 5): =E1/D1/50                                     -> #N/A (not #DIV/0!)
    //
    // This is the exact Issue #2 pattern: (P19-D19)/D19/J19 where D19
    // depends on a failed MATCH.
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        formula_cell(1, 0, 3, "INDEX(B1:B2,MATCH(\"NotFound\",A1:A2,0))"),
        formula_cell(1, 0, 4, "D1-100"),
        formula_cell(1, 0, 5, "(E1-D1)/D1/50"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 2,
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

    let (mirror, core, _result) = init_core(snapshot);

    let d0 = mirror_value(&mirror, SHEET1_UUID, 0, 3);
    assert_eq!(
        d0,
        CellValue::Error(CellError::Na, None),
        "D0: INDEX/MATCH should be #N/A"
    );

    let e0 = mirror_value(&mirror, SHEET1_UUID, 0, 4);
    assert_eq!(
        e0,
        CellValue::Error(CellError::Na, None),
        "E0: #N/A - 100 should propagate #N/A"
    );

    let f0 = mirror_value(&mirror, SHEET1_UUID, 0, 5);
    assert_eq!(
        f0,
        CellValue::Error(CellError::Na, None),
        "F0: (#N/A-#N/A)/#N/A/50 should propagate #N/A, not produce #DIV/0!"
    );
}

/// Test 5d: Addition of two cells that both contain MATCH errors.
/// Reproduces the `D22+D23` pattern from Issue #2.
#[test]
fn test_addition_of_two_match_error_cells() {
    // A0: =MATCH("X", B1:B3, 0)  -> #N/A
    // A1: =MATCH("Y", B1:B3, 0)  -> #N/A
    // B0: "P"  B1: "Q"  B2: "R"
    // C0: =A1+A2                  -> #N/A
    let cells = vec![
        val_cell(1, 0, 1, CellValue::Text("P".into())),
        val_cell(1, 1, 1, CellValue::Text("Q".into())),
        val_cell(1, 2, 1, CellValue::Text("R".into())),
        formula_cell(1, 0, 0, "MATCH(\"X\",B1:B3,0)"),
        formula_cell(1, 1, 0, "MATCH(\"Y\",B1:B3,0)"),
        formula_cell(1, 0, 2, "A1+A2"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 3,
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

    let (mirror, core, _result) = init_core(snapshot);

    let a0 = mirror_value(&mirror, SHEET1_UUID, 0, 0);
    assert_eq!(
        a0,
        CellValue::Error(CellError::Na, None),
        "A0 should be #N/A"
    );

    let a1 = mirror_value(&mirror, SHEET1_UUID, 1, 0);
    assert_eq!(
        a1,
        CellValue::Error(CellError::Na, None),
        "A1 should be #N/A"
    );

    let c0 = mirror_value(&mirror, SHEET1_UUID, 0, 2);
    assert_eq!(
        c0,
        CellValue::Error(CellError::Na, None),
        "A1+A2 where both are #N/A should produce #N/A"
    );
}

// ===========================================================================
// Issue #4: INDEX/MATCH with Array-IF (CSE-style)
// ===========================================================================

/// Test 6: MATCH with an array containing mixed types (numbers and FALSE/booleans).
/// When IF produces an array like [FALSE, 200, 300, FALSE], MATCH should be able
/// to search through it for a number.
#[test]
fn test_match_with_mixed_type_array() {
    // Manually test MATCH with an array argument that contains FALSE and numbers.
    // We can't easily produce this via formulas without the array-IF bug, so we
    // test the downstream behavior: can MATCH find a number in a column that
    // also contains booleans?
    //
    // A0: FALSE  B0: =MATCH(300, A1:A4, 0)  -> should be 3
    // A1: 200
    // A2: 300
    // A3: FALSE
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Boolean(false)),
        val_cell(1, 1, 0, CellValue::number(200.0)),
        val_cell(1, 2, 0, CellValue::number(300.0)),
        val_cell(1, 3, 0, CellValue::Boolean(false)),
        formula_cell(1, 0, 1, "MATCH(300,A1:A4,0)"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 2,
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

    let (mirror, core, _result) = init_core(snapshot);

    let val = mirror_value(&mirror, SHEET1_UUID, 0, 1);
    assert_eq!(
        val,
        CellValue::number(3.0),
        "MATCH(300, [FALSE, 200, 300, FALSE], 0) should return 3 (position of 300)"
    );
}

/// Test 7: IF in array context should produce an array for MATCH.
///
/// This is the core of Issue #4. The formula pattern is:
///   MATCH(target, IF(condition_range=criteria, value_range), 0)
///
/// In Excel (with Ctrl+Shift+Enter or dynamic arrays), IF evaluates element-wise:
///   IF({"Closed","Open","Closed","Open"}="Closed", {100,200,300,400})
///   -> {100, FALSE, 300, FALSE}
///
/// Then MATCH searches this array for the target value.
///
/// The bug: our evaluator's IF handler coerces the condition to a single boolean
/// instead of evaluating element-wise, so it returns either the full value_range
/// or FALSE (scalar), breaking MATCH.
#[test]
fn test_if_produces_array_for_match() {
    // Sheet "Data":
    //   A0: "Closed"  B0: 100
    //   A1: "Open"    B1: 200
    //   A2: "Closed"  B2: 300
    //   A3: "Open"    B3: 400
    //
    // Sheet "Results":
    //   A0: =MATCH(300, IF(Data!A1:A4="Closed", Data!B1:B4), 0)
    //
    // Expected: IF produces {100, FALSE, 300, FALSE}, MATCH finds 300 at position 3.
    // Actual bug: IF returns scalar, MATCH fails with #N/A.
    let data_cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Closed".into())),
        val_cell(1, 1, 0, CellValue::Text("Open".into())),
        val_cell(1, 2, 0, CellValue::Text("Closed".into())),
        val_cell(1, 3, 0, CellValue::Text("Open".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        val_cell(1, 2, 1, CellValue::number(300.0)),
        val_cell(1, 3, 1, CellValue::number(400.0)),
    ];

    let results_cells = vec![formula_cell(
        2,
        0,
        0,
        "MATCH(300,IF(Data!A1:A4=\"Closed\",Data!B1:B4),0)",
    )];

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Data".to_string(),
                rows: 4,
                cols: 2,
                cells: data_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Results".to_string(),
                rows: 1,
                cols: 1,
                cells: results_cells,
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

    let (mirror, core, result) = init_core(snapshot);

    let val = mirror_value(&mirror, SHEET2_UUID, 0, 0);
    println!(
        "test_if_produces_array_for_match: MATCH(300, IF(...)): {:?}",
        val
    );
    println!("  errors: {:?}", result.errors);

    // IF produces {100, FALSE, 300, FALSE}, MATCH finds 300 at position 3.
    assert_eq!(
        val,
        CellValue::number(3.0),
        "MATCH(300, IF(cond_range=\"Closed\", val_range), 0) should return 3"
    );
}

/// Test 8: Full corpus pattern — IFERROR(INDEX(C:C, MATCH(LARGE(IF(Q="X", K), 1), K:K, 0)), "--")
///
/// This is the exact formula from the corpus that causes 1,112+ errors.
#[test]
fn test_iferror_index_match_with_array_if() {
    // Sheet "Query" (using sheet index 1):
    //   Col A (0): Name       Col B (1): Status     Col C (2): Value
    //   Row 0: "Item1"        "Open"                50
    //   Row 1: "Item2"        "Closed"              200
    //   Row 2: "Item3"        "Closed"              300
    //   Row 3: "Item4"        "Open"                150
    //   Row 4: "Item5"        "Closed"              100
    //
    // Sheet "Results" (using sheet index 2):
    //   A0: =IFERROR(INDEX(Query!A1:A5, MATCH(LARGE(IF(Query!B1:B5="Closed", Query!C1:C5), 1), Query!C1:C5, 0)), "--")
    //
    // Expected behavior:
    //   IF(Query!B1:B5="Closed", Query!C1:C5) -> {FALSE, 200, 300, FALSE, 100}
    //   LARGE({FALSE, 200, 300, FALSE, 100}, 1) -> 300 (largest number, ignoring FALSE)
    //   MATCH(300, Query!C1:C5, 0) -> 3 (position of 300 in C column)
    //   INDEX(Query!A1:A5, 3) -> "Item3"
    //   IFERROR("Item3", "--") -> "Item3"
    //
    // Bug: IF returns scalar, LARGE gets wrong input, MATCH fails, falls to "--"

    let query_cells = vec![
        // Col A: Names
        val_cell(1, 0, 0, CellValue::Text("Item1".into())),
        val_cell(1, 1, 0, CellValue::Text("Item2".into())),
        val_cell(1, 2, 0, CellValue::Text("Item3".into())),
        val_cell(1, 3, 0, CellValue::Text("Item4".into())),
        val_cell(1, 4, 0, CellValue::Text("Item5".into())),
        // Col B: Status
        val_cell(1, 0, 1, CellValue::Text("Open".into())),
        val_cell(1, 1, 1, CellValue::Text("Closed".into())),
        val_cell(1, 2, 1, CellValue::Text("Closed".into())),
        val_cell(1, 3, 1, CellValue::Text("Open".into())),
        val_cell(1, 4, 1, CellValue::Text("Closed".into())),
        // Col C: Values
        val_cell(1, 0, 2, CellValue::number(50.0)),
        val_cell(1, 1, 2, CellValue::number(200.0)),
        val_cell(1, 2, 2, CellValue::number(300.0)),
        val_cell(1, 3, 2, CellValue::number(150.0)),
        val_cell(1, 4, 2, CellValue::number(100.0)),
    ];

    let results_cells = vec![formula_cell(
        2,
        0,
        0,
        "IFERROR(INDEX(Query!A1:A5,MATCH(LARGE(IF(Query!B1:B5=\"Closed\",Query!C1:C5),1),Query!C1:C5,0)),\"--\")",
    )];

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Query".to_string(),
                rows: 5,
                cols: 3,
                cells: query_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Results".to_string(),
                rows: 1,
                cols: 1,
                cells: results_cells,
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

    let (mirror, core, result) = init_core(snapshot);

    let val = mirror_value(&mirror, SHEET2_UUID, 0, 0);
    println!("test_iferror_index_match_with_array_if: result = {:?}", val);
    println!("  errors: {:?}", result.errors);

    // IF(Query!B1:B5="Closed", Query!C1:C5) -> {FALSE, 200, 300, FALSE, 100}
    // LARGE({FALSE, 200, 300, FALSE, 100}, 1) -> 300
    // MATCH(300, Query!C1:C5, 0) -> 3
    // INDEX(Query!A1:A5, 3) -> "Item3"
    // IFERROR("Item3", "--") -> "Item3"
    assert_eq!(
        val,
        CellValue::Text("Item3".into()),
        "Should return \"Item3\" — the name of the row with the largest Closed value"
    );
}

/// Test 9: LARGE with a mixed array containing FALSE and numbers.
/// LARGE should find the largest number, ignoring FALSE values.
///
/// This tests the downstream function: even if IF produced the right array,
/// does LARGE handle it correctly?
#[test]
fn test_large_with_mixed_array() {
    // We simulate what LARGE should receive from IF(cond="Closed", values):
    // An array with FALSE for non-matching rows and numbers for matching rows.
    //
    // A0: FALSE  A1: 200  A2: 300  A3: FALSE  A4: 100
    // B0: =LARGE(A1:A5, 1)  -> should be 300
    // B1: =LARGE(A1:A5, 2)  -> should be 200
    // B2: =LARGE(A1:A5, 3)  -> should be 100
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Boolean(false)),
        val_cell(1, 1, 0, CellValue::number(200.0)),
        val_cell(1, 2, 0, CellValue::number(300.0)),
        val_cell(1, 3, 0, CellValue::Boolean(false)),
        val_cell(1, 4, 0, CellValue::number(100.0)),
        formula_cell(1, 0, 1, "LARGE(A1:A5,1)"),
        formula_cell(1, 1, 1, "LARGE(A1:A5,2)"),
        formula_cell(1, 2, 1, "LARGE(A1:A5,3)"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 5,
            cols: 2,
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

    let (mirror, core, _result) = init_core(snapshot);

    let large1 = mirror_value(&mirror, SHEET1_UUID, 0, 1);
    assert_eq!(
        large1,
        CellValue::number(300.0),
        "LARGE([FALSE, 200, 300, FALSE, 100], 1) should be 300"
    );

    let large2 = mirror_value(&mirror, SHEET1_UUID, 1, 1);
    assert_eq!(
        large2,
        CellValue::number(200.0),
        "LARGE([FALSE, 200, 300, FALSE, 100], 2) should be 200"
    );

    let large3 = mirror_value(&mirror, SHEET1_UUID, 2, 1);
    assert_eq!(
        large3,
        CellValue::number(100.0),
        "LARGE([FALSE, 200, 300, FALSE, 100], 3) should be 100"
    );
}

/// Test 10: MATCH against a large range (simulating full column reference).
/// Tests that MATCH handles ranges with many empty cells correctly.
#[test]
fn test_match_with_large_range() {
    // 100 rows of data in column A, with MATCH looking through A1:A100.
    // Only 10 rows have actual data; the rest are empty.
    let mut cells = Vec::new();

    // Place data in rows 0, 10, 20, ... 90
    for i in 0..10u32 {
        let row = i * 10;
        cells.push(val_cell(
            1,
            row,
            0,
            CellValue::number((i + 1) as f64 * 100.0),
        ));
    }

    // MATCH formula looking for 500 (which is at row 40, position depends on range)
    cells.push(formula_cell(1, 0, 1, "MATCH(500,A1:A100,0)"));

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 2,
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

    let (mirror, core, _result) = init_core(snapshot);

    let val = mirror_value(&mirror, SHEET1_UUID, 0, 1);
    // 500 is at row 40 (0-indexed), which is position 41 in the range A1:A100.
    assert_eq!(
        val,
        CellValue::number(41.0),
        "MATCH(500, A1:A100, 0) should find 500 at row 41 (1-based position in range)"
    );
}

// ===========================================================================
// Full Integration Test: Multi-sheet INDEX/MATCH scenario
// ===========================================================================

/// Integration test with two sheets: "Data" and "Results".
///
/// Data sheet:
///   A: Name       B: Status    C: Value
///   0: "Alpha"    "Open"       100
///   1: "Beta"     "Closed"     200
///   2: "Gamma"    "Closed"     300
///   3: "Delta"    "Open"       150
///
/// Results sheet:
///   A0: =MATCH("Beta", Data!A1:A4, 0)                          -> 2
///   B0: =INDEX(Data!C1:C4, MATCH("Beta", Data!A1:A4, 0))       -> 200
///   C0: =IFERROR(INDEX(Data!A1:A4, MATCH(LARGE(IF(Data!B1:B4="Closed", Data!C1:C4), 1), Data!C1:C4, 0)), "--")
///         -> "Gamma" (300 is largest closed value, at position 3 in C, name is "Gamma")
#[test]
fn test_full_integration_two_sheet_index_match() {
    let data_cells = vec![
        // Column A: Names
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 2, 0, CellValue::Text("Gamma".into())),
        val_cell(1, 3, 0, CellValue::Text("Delta".into())),
        // Column B: Status
        val_cell(1, 0, 1, CellValue::Text("Open".into())),
        val_cell(1, 1, 1, CellValue::Text("Closed".into())),
        val_cell(1, 2, 1, CellValue::Text("Closed".into())),
        val_cell(1, 3, 1, CellValue::Text("Open".into())),
        // Column C: Values
        val_cell(1, 0, 2, CellValue::number(100.0)),
        val_cell(1, 1, 2, CellValue::number(200.0)),
        val_cell(1, 2, 2, CellValue::number(300.0)),
        val_cell(1, 3, 2, CellValue::number(150.0)),
    ];

    let results_cells = vec![
        // A0: Simple MATCH
        formula_cell(2, 0, 0, "MATCH(\"Beta\",Data!A1:A4,0)"),
        // B0: INDEX/MATCH
        formula_cell(2, 0, 1, "INDEX(Data!C1:C4,MATCH(\"Beta\",Data!A1:A4,0))"),
        // C0: Full IFERROR/INDEX/MATCH/LARGE/IF pattern
        formula_cell(
            2,
            0,
            2,
            "IFERROR(INDEX(Data!A1:A4,MATCH(LARGE(IF(Data!B1:B4=\"Closed\",Data!C1:C4),1),Data!C1:C4,0)),\"--\")",
        ),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Data".to_string(),
                rows: 4,
                cols: 3,
                cells: data_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Results".to_string(),
                rows: 1,
                cols: 3,
                cells: results_cells,
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

    let (mirror, core, result) = init_core(snapshot);

    // A0: MATCH("Beta", Data!A1:A4, 0) -> 2
    let a0 = mirror_value(&mirror, SHEET2_UUID, 0, 0);
    println!("Integration A0 (MATCH): {:?}", a0);
    assert_eq!(
        a0,
        CellValue::number(2.0),
        "MATCH('Beta', Data!A1:A4, 0) should return 2"
    );

    // B0: INDEX(Data!C1:C4, MATCH("Beta", Data!A1:A4, 0)) -> 200
    let b0 = mirror_value(&mirror, SHEET2_UUID, 0, 1);
    println!("Integration B0 (INDEX/MATCH): {:?}", b0);
    assert_eq!(
        b0,
        CellValue::number(200.0),
        "INDEX(Data!C1:C4, MATCH('Beta', Data!A1:A4, 0)) should return 200"
    );

    // C0: The full pattern - should return "Gamma" (name of row with largest Closed value)
    let c0 = mirror_value(&mirror, SHEET2_UUID, 0, 2);
    println!("Integration C0 (IFERROR/INDEX/MATCH/LARGE/IF): {:?}", c0);
    println!("  Recalc errors: {:?}", result.errors);

    assert_eq!(
        c0,
        CellValue::Text("Gamma".into()),
        "Should return \"Gamma\" — the name with the largest Closed value"
    );
}

// ===========================================================================
// Lazy INDEX Evaluation — False Circular Reference Tests
// ===========================================================================

/// Test 11: Cross-sheet INDEX/MATCH with whole-column refs should NOT produce #REF!.
///
/// This is the core false-cycle pattern from the LBO financial model:
///   Sheet A has INDEX(Sheet B!A:C, MATCH(..., Sheet B!A:A, 0), ...)
///   Sheet B has INDEX(Sheet A!A:C, MATCH(..., Sheet A!A:A, 0), ...)
///
/// Before the lazy INDEX fix, the eager `eval_node` on the range `Sheet B!A:C`
/// would demand-evaluate ALL dirty cells in that range, which includes cells
/// that reference back to Sheet A, creating a false cycle.
///
/// With lazy INDEX, only the single target cell (determined by MATCH) is
/// demand-evaluated, so no false cycle occurs.
#[test]
fn test_cross_sheet_index_match_no_false_cycle() {
    // Sheet "Debt" (index 1):
    //   A0: "Interest"   B0: 100   C0: =INDEX('Core'!A:C, MATCH("Revenue",'Core'!A:A,0), 2)
    //   A1: "Principal"  B1: 200   C1: =INDEX('Core'!A:C, MATCH("Costs",'Core'!A:A,0), 2)
    //
    // Sheet "Core" (index 2):
    //   A0: "Revenue"    B0: 500   C0: =INDEX('Debt'!A:C, MATCH("Interest",'Debt'!A:A,0), 2)
    //   A1: "Costs"      B1: 300   C1: =INDEX('Debt'!A:C, MATCH("Principal",'Debt'!A:A,0), 2)
    //
    // Expected:
    //   Debt!C0 = Core!B0 = 500 (Revenue's value)
    //   Debt!C1 = Core!B1 = 300 (Costs' value)
    //   Core!C0 = Debt!B0 = 100 (Interest's value)
    //   Core!C1 = Debt!B1 = 200 (Principal's value)

    let debt_cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Interest".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        formula_cell(1, 0, 2, "INDEX(Core!A:C,MATCH(\"Revenue\",Core!A:A,0),2)"),
        val_cell(1, 1, 0, CellValue::Text("Principal".into())),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        formula_cell(1, 1, 2, "INDEX(Core!A:C,MATCH(\"Costs\",Core!A:A,0),2)"),
    ];

    let core_cells = vec![
        val_cell(2, 0, 0, CellValue::Text("Revenue".into())),
        val_cell(2, 0, 1, CellValue::number(500.0)),
        formula_cell(2, 0, 2, "INDEX(Debt!A:C,MATCH(\"Interest\",Debt!A:A,0),2)"),
        val_cell(2, 1, 0, CellValue::Text("Costs".into())),
        val_cell(2, 1, 1, CellValue::number(300.0)),
        formula_cell(2, 1, 2, "INDEX(Debt!A:C,MATCH(\"Principal\",Debt!A:A,0),2)"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_UUID.to_string(),
                name: "Debt".to_string(),
                rows: 2,
                cols: 3,
                cells: debt_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_UUID.to_string(),
                name: "Core".to_string(),
                rows: 2,
                cols: 3,
                cells: core_cells,
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

    let (mirror, core, result) = init_core(snapshot);

    // Debt!C0 should get Revenue's value from Core!B0 = 500
    let debt_c0 = mirror_value(&mirror, SHEET1_UUID, 0, 2);
    assert_eq!(
        debt_c0,
        CellValue::number(500.0),
        "Debt!C0: INDEX(Core!A:C, MATCH('Revenue',...), 2) should return 500, not #REF!"
    );

    // Debt!C1 should get Costs' value from Core!B1 = 300
    let debt_c1 = mirror_value(&mirror, SHEET1_UUID, 1, 2);
    assert_eq!(
        debt_c1,
        CellValue::number(300.0),
        "Debt!C1: INDEX(Core!A:C, MATCH('Costs',...), 2) should return 300, not #REF!"
    );

    // Core!C0 should get Interest's value from Debt!B0 = 100
    let core_c0 = mirror_value(&mirror, SHEET2_UUID, 0, 2);
    assert_eq!(
        core_c0,
        CellValue::number(100.0),
        "Core!C0: INDEX(Debt!A:C, MATCH('Interest',...), 2) should return 100, not #REF!"
    );

    // Core!C1 should get Principal's value from Debt!B1 = 200
    let core_c1 = mirror_value(&mirror, SHEET2_UUID, 1, 2);
    assert_eq!(
        core_c1,
        CellValue::number(200.0),
        "Core!C1: INDEX(Debt!A:C, MATCH('Principal',...), 2) should return 200, not #REF!"
    );

    // No errors should have been reported
    assert!(
        result.errors.is_empty(),
        "No circular reference errors expected, got: {:?}",
        result.errors
    );
}

/// Test 12: INDEX with row_num=0 returns entire column, col_num=0 returns entire row.
/// In a single-cell formula context, the array result is spill-handled:
/// the formula cell gets the first element, and phantom cells get the rest.
#[test]
fn test_index_row_zero_col_zero() {
    // A0: 10  B0: 20  C0: 30
    // A1: 40  B1: 50  C1: 60
    // A2: 70  B2: 80  C2: 90
    //
    // D0: =INDEX(A1:C3, 0, 2) → column 2 = {20; 50; 80} → D0=20, D1=50(phantom), D2=80(phantom)
    // E0: =INDEX(A1:C3, 2, 0) → row 2 = {40, 50, 60} → E0=40, F0=50(phantom), G0=60(phantom)
    // (Using separate columns to avoid spill conflicts)
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 0, 1, CellValue::number(20.0)),
        val_cell(1, 0, 2, CellValue::number(30.0)),
        val_cell(1, 1, 0, CellValue::number(40.0)),
        val_cell(1, 1, 1, CellValue::number(50.0)),
        val_cell(1, 1, 2, CellValue::number(60.0)),
        val_cell(1, 2, 0, CellValue::number(70.0)),
        val_cell(1, 2, 1, CellValue::number(80.0)),
        val_cell(1, 2, 2, CellValue::number(90.0)),
        formula_cell(1, 0, 3, "INDEX(A1:C3,0,2)"), // D0: column 2 → spills down
        formula_cell(1, 0, 4, "INDEX(A1:C3,2,0)"), // E0: row 2 → spills right
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
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

    let (mirror, core, _) = init_core(snapshot);

    // D0: INDEX(A1:C3, 0, 2) → column B = {20; 50; 80}
    // Formula cell stores the first element after spill handling.
    let d0 = mirror_value(&mirror, SHEET1_UUID, 0, 3);
    assert_eq!(
        d0,
        CellValue::number(20.0),
        "D0: first element of column 2 (B0=20)"
    );

    // E0: INDEX(A1:C3, 2, 0) → row 2 = {40, 50, 60}
    // Formula cell stores the first element after spill handling.
    let e0 = mirror_value(&mirror, SHEET1_UUID, 0, 4);
    assert_eq!(
        e0,
        CellValue::number(40.0),
        "E0: first element of row 2 (A1=40)"
    );
}

/// Test 13: INDEX 2-arg form on single-row and single-col ranges.
#[test]
fn test_index_two_arg_single_row_col() {
    // Single-row range: A0: 10  B0: 20  C0: 30
    // D0: =INDEX(A1:C1, 2) → treats 2 as column index → B0 = 20
    //
    // Single-col range: A0: 100  A1: 200  A2: 300
    // D1: =INDEX(A1:A3, 2) → treats 2 as row index → A1 = 200
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 0, 1, CellValue::number(20.0)),
        val_cell(1, 0, 2, CellValue::number(30.0)),
        val_cell(1, 1, 0, CellValue::number(200.0)),
        val_cell(1, 2, 0, CellValue::number(300.0)),
        // Single-row: INDEX(A1:C1, 2) → column 2 = 20
        formula_cell(1, 0, 3, "INDEX(A1:C1,2)"),
        // Single-col: INDEX(A1:A3, 2) → row 2 = 200
        formula_cell(1, 1, 3, "INDEX(A1:A3,2)"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 3,
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

    let (mirror, core, _) = init_core(snapshot);

    let d0 = mirror_value(&mirror, SHEET1_UUID, 0, 3);
    assert_eq!(
        d0,
        CellValue::number(20.0),
        "INDEX(A1:C1, 2) on single-row should treat 2 as column index → 20"
    );

    let d1 = mirror_value(&mirror, SHEET1_UUID, 1, 3);
    assert_eq!(
        d1,
        CellValue::number(200.0),
        "INDEX(A1:A3, 2) on single-col should treat 2 as row index → 200"
    );
}

/// Test 14: Same-sheet INDEX with whole-column ref containing formulas.
/// INDEX(A:A, 3) where column A has formulas that reference the INDEX cell.
/// Should NOT create a false cycle — INDEX only needs cell A2.
#[test]
fn test_same_sheet_index_whole_column_no_false_cycle() {
    // A0: 10
    // A1: 20
    // A2: 30
    // B0: =INDEX(A:A, 3)    → should return A2 = 30
    // A3: =B1*2             → depends on B0, but INDEX(A:A,3) should NOT eval A3
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 1, 0, CellValue::number(20.0)),
        val_cell(1, 2, 0, CellValue::number(30.0)),
        formula_cell(1, 0, 1, "INDEX(A:A,3)"),
        formula_cell(1, 3, 0, "B1*2"),
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 2,
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

    let (mirror, core, result) = init_core(snapshot);

    let b0 = mirror_value(&mirror, SHEET1_UUID, 0, 1);
    assert_eq!(
        b0,
        CellValue::number(30.0),
        "INDEX(A:A, 3) should return 30 (A2), not #REF!"
    );

    // A3 = B0 * 2 = 30 * 2 = 60
    let a3 = mirror_value(&mirror, SHEET1_UUID, 3, 0);
    assert_eq!(
        a3,
        CellValue::number(60.0),
        "A3: =B1*2 should be 60 (B0=30, 30*2=60)"
    );

    assert!(
        result.errors.is_empty(),
        "No circular reference errors expected, got: {:?}",
        result.errors
    );
}
