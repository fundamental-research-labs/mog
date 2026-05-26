//! Integration tests for miscellaneous formula accuracy issues:
//!   - EOMONTH engine errors (6 errors)
//!   - Circular reference false positives (95 errors)
//!   - SUM/SUMPRODUCT errors (289+37 errors)
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_misc -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Helper utilities (same pattern as formula_accuracy_null_mismatch.rs)
// ---------------------------------------------------------------------------

/// Deterministic UUID-like string from sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (sheet_idx, row, col).
fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a minimal `WorkbookSnapshot` from a description of sheets.
/// Each sheet description is `(name, rows, cols, cells)` where `cells` is a vec
/// of `(row, col, value, formula)`.
fn build_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<&str>)>)>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
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

/// Find the evaluated value for a specific (sheet_index, row, col) in the RecalcResult.
fn find_changed_value(
    result: &RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target_cell_id)
        .map(|cc| cc.value.clone())
}

/// Assert that a cell evaluated to a specific number (within tolerance).
fn assert_cell_number(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: f64) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Cell ({},{},{}) expected {}, got {}",
                sheet_idx,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Cell ({},{},{}) expected Number({}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell ({},{},{}) not in changed_cells (expected Number({}))",
            sheet_idx, row, col, expected
        ),
    }
}

/// Check whether any error info mentions "Circular reference" for a given cell.
fn has_circular_error(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32) -> bool {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .errors
        .iter()
        .any(|e| e.cell_id == target_cell_id && e.error.contains("Circular"))
}

// ===========================================================================
// EOMONTH Tests
// ===========================================================================

/// EOMONTH(45658, 0): Jan 1 2025 + 0 months -> end of January 2025 = Jan 31 2025.
/// Jan 1 2025 = serial 45658, Jan 31 2025 = serial 45658 + 30 = 45688.
#[test]
fn test_eomonth_basic() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1: EOMONTH(45658, 0) — end of month for Jan 1, 2025 + 0 months
            (0, 0, CellValue::Null, Some("EOMONTH(45658,0)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_eomonth_basic ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Jan 31, 2025 = 45688
    assert_cell_number(&result, 0, 0, 0, 45688.0);
}

/// EOMONTH(45658, 3): Jan 1 2025 + 3 months -> end of April 2025 = Apr 30 2025.
#[test]
fn test_eomonth_positive_months() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("EOMONTH(45658,3)"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_eomonth_positive_months ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Apr 30, 2025: Jan 1 + 31 (Jan) + 28 (Feb) + 31 (Mar) + 30 (Apr) - 1 = 119 days offset
    // serial = 45658 + 119 = 45777
    assert_cell_number(&result, 0, 0, 0, 45777.0);
}

/// EOMONTH(45658, -1): Jan 1 2025 - 1 month -> end of December 2024 = Dec 31 2024.
#[test]
fn test_eomonth_negative_months() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("EOMONTH(45658,-1)"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_eomonth_negative_months ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Dec 31, 2024 = serial 45657 (one day before Jan 1, 2025)
    assert_cell_number(&result, 0, 0, 0, 45657.0);
}

/// EOMONTH for Feb in a leap year: starting from Jan 2024, +1 month = Feb 29 2024.
/// Jan 1, 2024 = serial 45292. Feb 29, 2024 = 45292 + 31 + 28 = 45292 + 59 = 45351.
#[test]
fn test_eomonth_feb_leap_year() {
    // Jan 1, 2024 serial: known from Jan 15, 2024 = 45306, so Jan 1 = 45292
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("EOMONTH(45292,1)"))],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_eomonth_feb_leap_year ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Feb 29, 2024 = 45351
    assert_cell_number(&result, 0, 0, 0, 45351.0);
}

/// EOMONTH inside an IF formula should NOT produce #SPILL! error.
/// IF(A1>0, EOMONTH(A1, 1), 0) where A1 is a date serial.
#[test]
fn test_eomonth_in_if_formula() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): date serial for Jan 15, 2025 = 45672
            // (Jan 1 2025 = 45658, Jan 15 = 45658 + 14 = 45672)
            (0, 0, CellValue::number(45672.0), None),
            // B1 (row 0, col 1): =IF(A1>0, EOMONTH(A1, 1), 0)
            (0, 1, CellValue::Null, Some("IF(A1>0,EOMONTH(A1,1),0)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_eomonth_in_if_formula ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // A1 = 45672 > 0, so EOMONTH(45672, 1) is called.
    // Jan 15 2025 + 1 month -> end of Feb 2025 = Feb 28 2025.
    // Feb 28, 2025 = Jan 1 2025 + 58 = 45658 + 58 = 45716.
    let val = find_changed_value(&result, 0, 0, 1);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - 45716.0).abs() < 1e-6,
                "Expected 45716 (Feb 28, 2025), got {}",
                n.get()
            );
        }
        Some(CellValue::Error(e, None)) => {
            panic!(
                "EOMONTH inside IF produced error {:?} — this is the EOMONTH/IF/#SPILL! bug",
                e
            );
        }
        Some(other) => panic!("Expected Number, got {:?}", other),
        None => {
            // Check if the value is stored in the core directly
            panic!("B1 not in changed_cells — formula may not have evaluated");
        }
    }
}

// ===========================================================================
// Circular Reference False Positive Tests
// ===========================================================================

/// Simple case: A1=B1+1, B1=5. No cycle should be detected.
#[test]
fn test_no_false_circular_ref_simple() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // B1 (row 0, col 1): value 5
            (0, 1, CellValue::number(5.0), None),
            // A1 (row 0, col 0): =B1+1
            (0, 0, CellValue::Null, Some("B1+1")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_no_false_circular_ref_simple ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Should NOT have a circular reference error
    assert!(
        !has_circular_error(&result, 0, 0, 0),
        "False circular reference detected for A1=B1+1, B1=5"
    );

    // A1 should be 6
    assert_cell_number(&result, 0, 0, 0, 6.0);
}

/// Cross-sheet dependency: Sheet1!A1 depends on Sheet2!B1, Sheet2!B1 depends on Sheet2!C1.
/// No cycle exists. All should compute correctly.
#[test]
fn test_no_false_circular_ref_cross_sheet() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![
                // A1: =Sheet2!B1+10
                (0, 0, CellValue::Null, Some("Sheet2!B1+10")),
            ],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                // C1 (row 0, col 2): value 5
                (0, 2, CellValue::number(5.0), None),
                // B1 (row 0, col 1): =C1*2
                (0, 1, CellValue::Null, Some("C1*2")),
            ],
        ),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_no_false_circular_ref_cross_sheet ===");
    for cc in &result.changed_cells {
        println!(
            "  cell_id={} sheet_id={} value={:?}",
            cc.cell_id, cc.sheet_id, cc.value
        );
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // No circular reference should be detected
    assert!(
        !has_circular_error(&result, 0, 0, 0),
        "False circular reference detected for cross-sheet dependency chain"
    );

    // Sheet2!B1 = C1*2 = 5*2 = 10
    assert_cell_number(&result, 1, 0, 1, 10.0);
    // Sheet1!A1 = Sheet2!B1+10 = 10+10 = 20
    assert_cell_number(&result, 0, 0, 0, 20.0);
}

/// Actual circular reference: A1=B1+1, B1=A1+1. Should be detected.
#[test]
fn test_actual_circular_ref_detected() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // A1 (row 0, col 0): =B1+1
            (0, 0, CellValue::number(0.0), Some("B1+1")),
            // B1 (row 0, col 1): =A1+1
            (0, 1, CellValue::number(0.0), Some("A1+1")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_actual_circular_ref_detected ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // At least one cell should have an error value (either #REF! from circular detection
    // or reported in result.errors)
    let a1_has_error = matches!(
        find_changed_value(&result, 0, 0, 0),
        Some(CellValue::Error(..))
    );
    let b1_has_error = matches!(
        find_changed_value(&result, 0, 0, 1),
        Some(CellValue::Error(..))
    );
    let has_circular_err =
        has_circular_error(&result, 0, 0, 0) || has_circular_error(&result, 0, 0, 1);

    assert!(
        a1_has_error || b1_has_error || has_circular_err,
        "Actual circular reference A1=B1+1, B1=A1+1 was NOT detected"
    );
}

/// Shared dependency, no cycle: A1=C1+1, B1=C1+2, C1=5.
/// Both A1 and B1 depend on C1 but not on each other.
#[test]
fn test_no_false_circular_with_shared_dependency() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            // C1 (row 0, col 2): value 5
            (0, 2, CellValue::number(5.0), None),
            // A1 (row 0, col 0): =C1+1
            (0, 0, CellValue::Null, Some("C1+1")),
            // B1 (row 0, col 1): =C1+2
            (0, 1, CellValue::Null, Some("C1+2")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_no_false_circular_with_shared_dependency ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // No circular reference should be detected
    assert!(
        !has_circular_error(&result, 0, 0, 0),
        "False circular reference detected for A1=C1+1"
    );
    assert!(
        !has_circular_error(&result, 0, 0, 1),
        "False circular reference detected for B1=C1+2"
    );

    // A1 = C1+1 = 6
    assert_cell_number(&result, 0, 0, 0, 6.0);
    // B1 = C1+2 = 7
    assert_cell_number(&result, 0, 0, 1, 7.0);
}

// ===========================================================================
// SUM Tests
// ===========================================================================

/// SUM(A1:A5) where A3 contains #N/A. SUM should propagate the error.
#[test]
fn test_sum_with_error_in_range() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(1.0), None),                // A1
            (1, 0, CellValue::number(2.0), None),                // A2
            (2, 0, CellValue::Error(CellError::Na, None), None), // A3 = #N/A
            (3, 0, CellValue::number(4.0), None),                // A4
            (4, 0, CellValue::number(5.0), None),                // A5
            // B1: =SUM(A1:A5)
            (0, 1, CellValue::Null, Some("SUM(A1:A5)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sum_with_error_in_range ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // SUM should propagate #N/A when the range contains an error
    let val = find_changed_value(&result, 0, 0, 1);
    match val {
        Some(CellValue::Error(CellError::Na, None)) => { /* correct */ }
        Some(CellValue::Error(e, None)) => {
            // Any error propagation is acceptable (though #N/A is most correct)
            println!("SUM propagated error {:?} (expected #N/A)", e);
        }
        Some(other) => panic!(
            "SUM(A1:A5) with #N/A in range should return an error, got {:?}",
            other
        ),
        None => panic!("SUM(A1:A5) not in changed_cells"),
    }
}

/// SUM(A1:A5) where some cells are empty. Empty cells should be treated as 0.
#[test]
fn test_sum_with_empty_cells() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(10.0), None), // A1 = 10
            // A2 is empty (not in cells list)
            (2, 0, CellValue::number(20.0), None), // A3 = 20
            // A4 is empty
            (4, 0, CellValue::number(30.0), None), // A5 = 30
            // B1: =SUM(A1:A5)
            (0, 1, CellValue::Null, Some("SUM(A1:A5)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sum_with_empty_cells ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // SUM(10, empty, 20, empty, 30) = 60
    assert_cell_number(&result, 0, 0, 1, 60.0);
}

/// SUM across sheets: SUM(Sheet2!A1:A10) where Sheet2 has numeric values.
#[test]
fn test_sum_cross_sheet() {
    let mut sheet2_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    for i in 0..10 {
        sheet2_cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![
                // A1: =SUM(Sheet2!A1:A10)
                (0, 0, CellValue::Null, Some("SUM(Sheet2!A1:A10)")),
            ],
        ),
        ("Sheet2", 20, 10, sheet2_cells),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sum_cross_sheet ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // SUM(1+2+3+4+5+6+7+8+9+10) = 55
    assert_cell_number(&result, 0, 0, 0, 55.0);
}

// ===========================================================================
// SUMPRODUCT Tests
// ===========================================================================

/// Basic SUMPRODUCT(A1:A3, B1:B3) with numeric arrays.
#[test]
fn test_sumproduct_basic() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(1.0), None), // A1
            (1, 0, CellValue::number(2.0), None), // A2
            (2, 0, CellValue::number(3.0), None), // A3
            (0, 1, CellValue::number(4.0), None), // B1
            (1, 1, CellValue::number(5.0), None), // B2
            (2, 1, CellValue::number(6.0), None), // B3
            // C1: =SUMPRODUCT(A1:A3, B1:B3)
            (0, 2, CellValue::Null, Some("SUMPRODUCT(A1:A3,B1:B3)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sumproduct_basic ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // SUMPRODUCT = 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    assert_cell_number(&result, 0, 0, 2, 32.0);
}

/// SUMPRODUCT(ISNUMBER(SEARCH("text", A1:A5))*1) — common pattern for counting
/// cells that contain a substring. SEARCH returns position or #VALUE!, ISNUMBER
/// converts to TRUE/FALSE, *1 converts to 1/0, SUMPRODUCT sums.
#[test]
fn test_sumproduct_with_isnumber_search() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::Text("hello text world".into()), None), // A1: contains "text"
            (1, 0, CellValue::Text("no match here".into()), None),    // A2: no match
            (2, 0, CellValue::Text("text at start".into()), None),    // A3: contains "text"
            (3, 0, CellValue::Text("TEXT uppercase".into()), None), // A4: contains "text" (case-insensitive)
            (4, 0, CellValue::Text("nothing".into()), None),        // A5: no match
            // B1: =SUMPRODUCT(ISNUMBER(SEARCH("text",A1:A5))*1)
            (
                0,
                1,
                CellValue::Null,
                Some("SUMPRODUCT(ISNUMBER(SEARCH(\"text\",A1:A5))*1)"),
            ),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sumproduct_with_isnumber_search ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // A1 contains "text" -> SEARCH returns a number -> ISNUMBER=TRUE -> *1 = 1
    // A2 does not contain "text" -> SEARCH returns #VALUE! -> ISNUMBER=FALSE -> *1 = 0
    // A3 contains "text" -> 1
    // A4 contains "TEXT" (SEARCH is case-insensitive) -> 1
    // A5 does not contain "text" -> 0
    // SUMPRODUCT = 1+0+1+1+0 = 3
    let val = find_changed_value(&result, 0, 0, 1);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - 3.0).abs() < 1e-6,
                "SUMPRODUCT(ISNUMBER(SEARCH(\"text\",A1:A5))*1) expected 3, got {}",
                n.get()
            );
        }
        Some(CellValue::Error(e, None)) => {
            panic!(
                "SUMPRODUCT/ISNUMBER/SEARCH pattern produced error {:?} — this is the SUMPRODUCT bug",
                e
            );
        }
        Some(other) => panic!("Expected Number(3), got {:?}", other),
        None => panic!("B1 not in changed_cells"),
    }
}

/// SUMPRODUCT with boolean coercion: SUMPRODUCT((A1:A3>0)*1).
/// Comparison produces boolean array, *1 converts to numeric, SUMPRODUCT sums.
#[test]
fn test_sumproduct_boolean_coercion() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![
            (0, 0, CellValue::number(5.0), None),  // A1 = 5 (> 0)
            (1, 0, CellValue::number(-3.0), None), // A2 = -3 (not > 0)
            (2, 0, CellValue::number(10.0), None), // A3 = 10 (> 0)
            // B1: =SUMPRODUCT((A1:A3>0)*1)
            (0, 1, CellValue::Null, Some("SUMPRODUCT((A1:A3>0)*1)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== test_sumproduct_boolean_coercion ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // (5>0)*1=1, (-3>0)*1=0, (10>0)*1=1 -> SUMPRODUCT = 2
    let val = find_changed_value(&result, 0, 0, 1);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - 2.0).abs() < 1e-6,
                "SUMPRODUCT((A1:A3>0)*1) expected 2, got {}",
                n.get()
            );
        }
        Some(CellValue::Error(e, None)) => {
            panic!("SUMPRODUCT with boolean coercion produced error {:?}", e);
        }
        Some(other) => panic!("Expected Number(2), got {:?}", other),
        None => panic!("B1 not in changed_cells"),
    }
}
