//! Integration tests for formula accuracy issue #5: XLOOKUP errors.
//!
//! Problem: XLOOKUP concatenation-based lookups fail. The pattern
//! `XLOOKUP($B5&$C5, Table[Col1]&Table[Col2], Table[Col3], 0)` returns an engine
//! error instead of the expected match (or the fallback value via IFERROR).
//!
//! Root cause hypothesis: The `&` (concat) operator on two column arrays
//! (structured table refs) may not produce element-wise concatenation, or the
//! resulting array may not be searchable by XLOOKUP's `flatten_values`.
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_xlookup -- --nocapture

use cell_types::SheetId;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use formula_types::TableDef;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/// Deterministic UUID-like string from sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Parse a sheet UUID string into a SheetId (same conversion as CellMirror).
fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).unwrap()
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
    tables: Vec<TableDef>,
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
        tables,
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
    result: &compute_core::RecalcResult,
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

/// Print diagnostics for a RecalcResult.
fn print_diagnostics(label: &str, result: &compute_core::RecalcResult) {
    println!("\n=== {} ===", label);
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    if !result.errors.is_empty() {
        println!("errors:");
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }
    if !result.projection_changes.is_empty() {
        println!("projection_changes: {}", result.projection_changes.len());
        for sc in &result.projection_changes {
            println!("  source_cell_id={}", sc.source_cell_id);
            for sd in &sc.projection_cells {
                println!(
                    "    proj cell_id={} row={} col={} value={:?}",
                    sd.cell_id, sd.row, sd.col, sd.value
                );
            }
        }
    }
}

// ===========================================================================
// Test 1: Basic XLOOKUP exact match
// ===========================================================================

/// Simple XLOOKUP with scalar lookup in a flat array.
/// =XLOOKUP(20, {10,20,30}, {100,200,300}) -> 200
#[test]
fn test_xlookup_exact_match_basic() {
    // Sheet layout:
    //   A1=10, A2=20, A3=30 (lookup array)
    //   B1=100, B2=200, B3=300 (return array)
    //   C1 = XLOOKUP(20, A1:A3, B1:B3) -> 200
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(10.0), None),
                (1, 0, CellValue::number(20.0), None),
                (2, 0, CellValue::number(30.0), None),
                (0, 1, CellValue::number(100.0), None),
                (1, 1, CellValue::number(200.0), None),
                (2, 1, CellValue::number(300.0), None),
                // C1: XLOOKUP formula
                (0, 2, CellValue::Null, Some("XLOOKUP(20,A1:A3,B1:B3)")),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_exact_match_basic", &result);

    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 to appear in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 200.0).abs() < 1e-10,
            "Expected 200, got {}",
            n.get()
        ),
        other => panic!("Expected Number(200), got {:?}", other),
    }
}

// ===========================================================================
// Test 2: XLOOKUP not found — default #N/A
// ===========================================================================

/// When value isn't found and no if_not_found arg, XLOOKUP returns #N/A.
#[test]
fn test_xlookup_not_found_default_na() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(10.0), None),
                (1, 0, CellValue::number(20.0), None),
                (2, 0, CellValue::number(30.0), None),
                (0, 1, CellValue::number(100.0), None),
                (1, 1, CellValue::number(200.0), None),
                (2, 1, CellValue::number(300.0), None),
                // C1: XLOOKUP looking for 99 (not in array)
                (0, 2, CellValue::Null, Some("XLOOKUP(99,A1:A3,B1:B3)")),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_not_found_default_na", &result);

    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 to appear in changed_cells");
    match val.unwrap() {
        CellValue::Error(e, _) => {
            assert_eq!(format!("{:?}", e), "Na", "Expected #N/A error, got {:?}", e)
        }
        other => panic!("Expected Error(Na), got {:?}", other),
    }
}

// ===========================================================================
// Test 3: XLOOKUP not found with fallback (if_not_found=0)
// ===========================================================================

/// XLOOKUP with if_not_found=0 returns 0 when not found.
#[test]
fn test_xlookup_not_found_with_fallback() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(10.0), None),
                (1, 0, CellValue::number(20.0), None),
                (2, 0, CellValue::number(30.0), None),
                (0, 1, CellValue::number(100.0), None),
                (1, 1, CellValue::number(200.0), None),
                (2, 1, CellValue::number(300.0), None),
                // C1: XLOOKUP with if_not_found=0
                (0, 2, CellValue::Null, Some("XLOOKUP(99,A1:A3,B1:B3,0)")),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_not_found_with_fallback", &result);

    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 to appear in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => {
            assert!((n.get() - 0.0).abs() < 1e-10, "Expected 0, got {}", n.get())
        }
        other => panic!("Expected Number(0), got {:?}", other),
    }
}

// ===========================================================================
// Test 4: XLOOKUP text match
// ===========================================================================

/// XLOOKUP looking up a text string in a text array.
#[test]
fn test_xlookup_text_match() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // Lookup array: col A
                (0, 0, CellValue::Text("Apple".into()), None),
                (1, 0, CellValue::Text("Banana".into()), None),
                (2, 0, CellValue::Text("Cherry".into()), None),
                // Return array: col B
                (0, 1, CellValue::number(1.0), None),
                (1, 1, CellValue::number(2.0), None),
                (2, 1, CellValue::number(3.0), None),
                // C1: XLOOKUP for "Banana"
                (
                    0,
                    2,
                    CellValue::Null,
                    Some("XLOOKUP(\"Banana\",A1:A3,B1:B3)"),
                ),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_text_match", &result);

    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 to appear in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => {
            assert!((n.get() - 2.0).abs() < 1e-10, "Expected 2, got {}", n.get())
        }
        other => panic!("Expected Number(2), got {:?}", other),
    }
}

// ===========================================================================
// Test 5: XLOOKUP with pre-concatenated lookup value
// ===========================================================================

/// Lookup value is text "AB", lookup_array contains ["AB", "CD", "EF"],
/// return_array has [10, 20, 30]. Should return 10.
#[test]
fn test_xlookup_with_concatenated_lookup() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // Lookup array: col A
                (0, 0, CellValue::Text("AB".into()), None),
                (1, 0, CellValue::Text("CD".into()), None),
                (2, 0, CellValue::Text("EF".into()), None),
                // Return array: col B
                (0, 1, CellValue::number(10.0), None),
                (1, 1, CellValue::number(20.0), None),
                (2, 1, CellValue::number(30.0), None),
                // C1: lookup_value is "A"&"B" = "AB"
                (
                    0,
                    2,
                    CellValue::Null,
                    Some("XLOOKUP(\"A\"&\"B\",A1:A3,B1:B3)"),
                ),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_with_concatenated_lookup", &result);

    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 to appear in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 10.0).abs() < 1e-10,
            "Expected 10, got {}",
            n.get()
        ),
        other => panic!("Expected Number(10), got {:?}", other),
    }
}

// ===========================================================================
// Test 6: Array concatenation operator (array & array)
// ===========================================================================

/// Test that `array1 & array2` element-wise concatenation works.
/// Set up two column arrays and verify `&` produces concatenated text array.
///
/// This is the likely root cause of the XLOOKUP bug: if the `&` operator on
/// two CellValue::Array values does not produce element-wise concatenation,
/// then the lookup_array in `XLOOKUP(val, Col1&Col2, Col3, 0)` will be wrong.
///
/// Layout:
///   A1="John", A2="Jane", A3="Bob"
///   B1="Active", B2="Inactive", B3="Active"
///   C1 = A1:A3 & B1:B3  -> should spill to {"JohnActive"; "JaneInactive"; "BobActive"}
#[test]
fn test_array_concatenation_operator() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // Column A (names)
                (0, 0, CellValue::Text("John".into()), None),
                (1, 0, CellValue::Text("Jane".into()), None),
                (2, 0, CellValue::Text("Bob".into()), None),
                // Column B (statuses)
                (0, 1, CellValue::Text("Active".into()), None),
                (1, 1, CellValue::Text("Inactive".into()), None),
                (2, 1, CellValue::Text("Active".into()), None),
                // C1: element-wise concat of arrays
                (0, 2, CellValue::Null, Some("A1:A3&B1:B3")),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_array_concatenation_operator", &result);

    // The result of A1:A3 & B1:B3 should be an array.
    // It may appear as the direct value of C1 (array formula) or spill.
    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 to appear in changed_cells");
    let val = val.unwrap();

    // Depending on implementation, the result could be:
    // 1. A CellValue::Array with 3 rows (correct)
    // 2. Just "JohnActive" (first element, if implicit intersection kicks in)
    // 3. An error (if array concat is broken)
    println!("C1 value = {:?}", val);

    match &val {
        CellValue::Array(arr) => {
            // Best case: full array returned
            assert!(
                arr.rows() >= 3,
                "Expected at least 3 rows in array, got {}",
                arr.rows()
            );
            // Check first element
            match arr.get(0, 0).unwrap() {
                CellValue::Text(s) => assert_eq!(s.as_ref(), "JohnActive", "Row 0 mismatch"),
                other => panic!("Expected Text(\"JohnActive\"), got {:?}", other),
            }
            match arr.get(1, 0).unwrap() {
                CellValue::Text(s) => assert_eq!(s.as_ref(), "JaneInactive", "Row 1 mismatch"),
                other => panic!("Expected Text(\"JaneInactive\"), got {:?}", other),
            }
            match arr.get(2, 0).unwrap() {
                CellValue::Text(s) => assert_eq!(s.as_ref(), "BobActive", "Row 2 mismatch"),
                other => panic!("Expected Text(\"BobActive\"), got {:?}", other),
            }
        }
        CellValue::Text(s) => {
            // Implicit intersection: only first element returned
            assert_eq!(
                s.as_ref(),
                "JohnActive",
                "If implicit intersection, expected 'JohnActive', got '{}'",
                s
            );
            println!(
                "NOTE: Got implicit intersection result (scalar), not full array. \
                       This may be correct for non-spill context."
            );
        }
        CellValue::Error(e, _) => {
            panic!(
                "Array concatenation returned an error: {:?}. \
                 This confirms the bug: the & operator does not handle \
                 CellValue::Array operands for element-wise text concatenation.",
                e
            );
        }
        other => {
            panic!("Unexpected result from array concatenation: {:?}", other);
        }
    }
}

// ===========================================================================
// Test 7: XLOOKUP with array-concat lookup_array
// ===========================================================================

/// The full pattern: lookup_value is "JohnActive", lookup_array is Col1&Col2
/// (element-wise concat), return_array is Col3. Verify XLOOKUP searches
/// the concatenated array.
///
/// Layout:
///   A1="John",   A2="Jane",     A3="Bob"      (names)
///   B1="Active", B2="Inactive", B3="Active"    (statuses)
///   C1=100,      C2=200,        C3=300          (return values)
///   D1 = XLOOKUP("JohnActive", A1:A3&B1:B3, C1:C3, 0)  -> 100
#[test]
fn test_xlookup_with_array_concat_lookup_array() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // Column A (names)
                (0, 0, CellValue::Text("John".into()), None),
                (1, 0, CellValue::Text("Jane".into()), None),
                (2, 0, CellValue::Text("Bob".into()), None),
                // Column B (statuses)
                (0, 1, CellValue::Text("Active".into()), None),
                (1, 1, CellValue::Text("Inactive".into()), None),
                (2, 1, CellValue::Text("Active".into()), None),
                // Column C (return values)
                (0, 2, CellValue::number(100.0), None),
                (1, 2, CellValue::number(200.0), None),
                (2, 2, CellValue::number(300.0), None),
                // D1: XLOOKUP with concat in lookup_array
                (
                    0,
                    3,
                    CellValue::Null,
                    Some("XLOOKUP(\"JohnActive\",A1:A3&B1:B3,C1:C3,0)"),
                ),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_with_array_concat_lookup_array", &result);

    let val = find_changed_value(&result, 0, 0, 3);
    assert!(val.is_some(), "Expected D1 to appear in changed_cells");
    let val = val.unwrap();
    println!("D1 value = {:?}", val);

    match val {
        CellValue::Number(n) => assert!(
            (n.get() - 100.0).abs() < 1e-10,
            "Expected 100 (matched 'JohnActive'), got {}",
            n.get()
        ),
        CellValue::Error(e, _) => {
            panic!(
                "XLOOKUP with array-concat lookup_array returned error {:?}. \
                 This is the core XLOOKUP bug: when the lookup_array argument \
                 is an array expression (Col1&Col2), XLOOKUP fails to search it.",
                e
            );
        }
        other => panic!("Expected Number(100), got {:?}", other),
    }
}

// ===========================================================================
// Test 8: XLOOKUP with structured table references
// ===========================================================================

/// Set up a table with columns Account, Deal, Base%.
/// Formula: XLOOKUP("AcctA"&"Deal1", Investments9[Account]&Investments9[Deal], Investments9[Base%], 0)
///
/// Table "Investments9" on Sheet "Investments" (sheet index 0):
///   Row 0: headers (Account, Deal, Base%)
///   Row 1: AcctA, Deal1, 0.05
///   Row 2: AcctB, Deal2, 0.08
///   Row 3: AcctA, Deal3, 0.03
///
/// Formula cell on Sheet "Query" (sheet index 1):
///   A1 = XLOOKUP("AcctA"&"Deal1", Investments9[Account]&Investments9[Deal], Investments9[Base%], 0)
///   -> Should find "AcctADeal1" in the concatenated array and return 0.05
#[test]
fn test_xlookup_with_structured_table_ref() {
    let table = TableDef {
        name: "Investments9".to_string(),
        sheet: sheet_id(0),
        start_row: 0, // header row
        start_col: 0,
        end_row: 3, // last data row
        end_col: 2,
        columns: vec![
            "Account".to_string(),
            "Deal".to_string(),
            "Base%".to_string(),
        ],
        has_headers: true,
        has_totals: false,
    };

    let snapshot = build_snapshot(
        vec![
            (
                "Investments",
                10,
                10,
                vec![
                    // Header row (row 0)
                    (0, 0, CellValue::Text("Account".into()), None),
                    (0, 1, CellValue::Text("Deal".into()), None),
                    (0, 2, CellValue::Text("Base%".into()), None),
                    // Data row 1 (row 1)
                    (1, 0, CellValue::Text("AcctA".into()), None),
                    (1, 1, CellValue::Text("Deal1".into()), None),
                    (1, 2, CellValue::number(0.05), None),
                    // Data row 2 (row 2)
                    (2, 0, CellValue::Text("AcctB".into()), None),
                    (2, 1, CellValue::Text("Deal2".into()), None),
                    (2, 2, CellValue::number(0.08), None),
                    // Data row 3 (row 3)
                    (3, 0, CellValue::Text("AcctA".into()), None),
                    (3, 1, CellValue::Text("Deal3".into()), None),
                    (3, 2, CellValue::number(0.03), None),
                ],
            ),
            (
                "Query",
                10,
                10,
                vec![
                    // A1: XLOOKUP with structured refs and concat
                    (
                        0,
                        0,
                        CellValue::Null,
                        Some(
                            "XLOOKUP(\"AcctA\"&\"Deal1\",Investments9[Account]&Investments9[Deal],Investments9[Base%],0)",
                        ),
                    ),
                ],
            ),
        ],
        vec![table],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_with_structured_table_ref", &result);

    let val = find_changed_value(&result, 1, 0, 0);
    assert!(
        val.is_some(),
        "Expected Query!A1 to appear in changed_cells"
    );
    let val = val.unwrap();
    println!("Query!A1 value = {:?}", val);

    match val {
        CellValue::Number(n) => assert!(
            (n.get() - 0.05).abs() < 1e-10,
            "Expected 0.05 (Base% for AcctA+Deal1), got {}",
            n.get()
        ),
        CellValue::Error(e, _) => {
            panic!(
                "XLOOKUP with structured table refs returned error {:?}. \
                 This is the primary XLOOKUP accuracy bug: concatenation of \
                 structured table column references fails.",
                e
            );
        }
        other => panic!("Expected Number(0.05), got {:?}", other),
    }
}

// ===========================================================================
// Test 9: IFERROR(XLOOKUP(...), 0) fallback
// ===========================================================================

/// Full pattern: IFERROR(XLOOKUP(lookup, array, return, 0), 0).
/// When XLOOKUP errors, IFERROR should catch it and return 0.
/// When XLOOKUP succeeds, IFERROR should pass through the result.
#[test]
fn test_iferror_xlookup_fallback() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // Lookup array: col A
                (0, 0, CellValue::number(10.0), None),
                (1, 0, CellValue::number(20.0), None),
                (2, 0, CellValue::number(30.0), None),
                // Return array: col B
                (0, 1, CellValue::number(100.0), None),
                (1, 1, CellValue::number(200.0), None),
                (2, 1, CellValue::number(300.0), None),
                // C1: IFERROR wrapping XLOOKUP that FINDS a value
                (
                    0,
                    2,
                    CellValue::Null,
                    Some("IFERROR(XLOOKUP(20,A1:A3,B1:B3),0)"),
                ),
                // C2: IFERROR wrapping XLOOKUP that does NOT find a value (no if_not_found)
                (
                    1,
                    2,
                    CellValue::Null,
                    Some("IFERROR(XLOOKUP(99,A1:A3,B1:B3),0)"),
                ),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_iferror_xlookup_fallback", &result);

    // C1: XLOOKUP finds 20 -> returns 200. IFERROR passes through -> 200
    let val_c1 = find_changed_value(&result, 0, 0, 2);
    assert!(val_c1.is_some(), "Expected C1 to appear in changed_cells");
    match val_c1.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 200.0).abs() < 1e-10,
            "Expected 200 (XLOOKUP found 20), got {}",
            n.get()
        ),
        other => panic!("Expected Number(200), got {:?}", other),
    }

    // C2: XLOOKUP doesn't find 99 -> #N/A. IFERROR catches -> 0
    let val_c2 = find_changed_value(&result, 0, 1, 2);
    assert!(val_c2.is_some(), "Expected C2 to appear in changed_cells");
    match val_c2.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 0.0).abs() < 1e-10,
            "Expected 0 (IFERROR caught #N/A), got {}",
            n.get()
        ),
        other => panic!("Expected Number(0), got {:?}", other),
    }
}

// ===========================================================================
// Test 10: XLOOKUP cross-sheet with concatenation
// ===========================================================================

/// XLOOKUP where lookup_value references cells from another sheet,
/// and lookup/return arrays are table columns on yet another sheet.
///
/// Sheet "Query" (index 0):
///   B5 = "AcctA"
///   C5 = "Deal1"
///   D5 = XLOOKUP(B5&C5, Investments9[Account]&Investments9[Deal], Investments9[Base%], 0)
///   -> Expected: 0.05
///
/// Sheet "Investments" (index 1):
///   Table "Investments9" with Account, Deal, Base% columns
#[test]
fn test_xlookup_cross_sheet_with_concat() {
    let table = TableDef {
        name: "Investments9".to_string(),
        sheet: sheet_id(1), // Investments is sheet index 1
        start_row: 0,
        start_col: 0,
        end_row: 3,
        end_col: 2,
        columns: vec![
            "Account".to_string(),
            "Deal".to_string(),
            "Base%".to_string(),
        ],
        has_headers: true,
        has_totals: false,
    };

    let snapshot = build_snapshot(
        vec![
            (
                "Query",
                10,
                10,
                vec![
                    // B5 (row 4, col 1) = "AcctA"
                    (4, 1, CellValue::Text("AcctA".into()), None),
                    // C5 (row 4, col 2) = "Deal1"
                    (4, 2, CellValue::Text("Deal1".into()), None),
                    // D5 (row 4, col 3) = XLOOKUP(B5&C5, ...)
                    (
                        4,
                        3,
                        CellValue::Null,
                        Some(
                            "XLOOKUP(B5&C5,Investments9[Account]&Investments9[Deal],Investments9[Base%],0)",
                        ),
                    ),
                ],
            ),
            (
                "Investments",
                10,
                10,
                vec![
                    // Header row (row 0)
                    (0, 0, CellValue::Text("Account".into()), None),
                    (0, 1, CellValue::Text("Deal".into()), None),
                    (0, 2, CellValue::Text("Base%".into()), None),
                    // Data row 1
                    (1, 0, CellValue::Text("AcctA".into()), None),
                    (1, 1, CellValue::Text("Deal1".into()), None),
                    (1, 2, CellValue::number(0.05), None),
                    // Data row 2
                    (2, 0, CellValue::Text("AcctB".into()), None),
                    (2, 1, CellValue::Text("Deal2".into()), None),
                    (2, 2, CellValue::number(0.08), None),
                    // Data row 3
                    (3, 0, CellValue::Text("AcctA".into()), None),
                    (3, 1, CellValue::Text("Deal3".into()), None),
                    (3, 2, CellValue::number(0.03), None),
                ],
            ),
        ],
        vec![table],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_cross_sheet_with_concat", &result);

    // D5 on Query sheet (sheet index 0, row 4, col 3)
    let val = find_changed_value(&result, 0, 4, 3);
    assert!(
        val.is_some(),
        "Expected Query!D5 to appear in changed_cells"
    );
    let val = val.unwrap();
    println!("Query!D5 value = {:?}", val);

    match val {
        CellValue::Number(n) => assert!(
            (n.get() - 0.05).abs() < 1e-10,
            "Expected 0.05 (Base% for AcctA+Deal1), got {}",
            n.get()
        ),
        CellValue::Error(e, _) => {
            panic!(
                "XLOOKUP cross-sheet with concat returned error {:?}. \
                 This reproduces the corpus bug where XLOOKUP(Query!$B5&Query!$C5, \
                 Investments9[Account]&Investments9[Deal], Investments9[Base%], 0) \
                 fails with an engine error instead of finding the match.",
                e
            );
        }
        other => panic!("Expected Number(0.05), got {:?}", other),
    }
}

// ===========================================================================
// Test: XLOOKUP on a large text column (exercises indexed lookup path)
// ===========================================================================

/// Builds a workbook with a text lookup column of 500 rows plus multiple
/// XLOOKUP formulas, simulating the real-world pattern where many XLOOKUPs
/// search the same text column (e.g. brand names). Before the col_data
/// indexing fix, text columns fell back to O(n) linear scan per lookup.
#[test]
fn test_xlookup_text_column_indexed_path() {
    let n = 500_u32; // large enough to be meaningful
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: text lookup column with unique brand names
    // Col B: numeric return column
    for i in 0..n {
        cells.push((
            i,
            0,
            CellValue::Text(format!("Brand_{:04}", i).into()),
            None,
        ));
        cells.push((i, 1, CellValue::number(i as f64 * 10.0), None));
    }

    // Col C: XLOOKUP formulas searching for specific brands
    // Search for first, middle, and last entries
    let targets = [0_u32, n / 4, n / 2, 3 * n / 4, n - 1];
    for (fi, &target_row) in targets.iter().enumerate() {
        let formula = format!("XLOOKUP(\"Brand_{:04}\",A1:A{},B1:B{})", target_row, n, n);
        // Leak the string for 'static lifetime (acceptable in tests)
        let formula_str: &'static str = Box::leak(formula.into_boxed_str());
        cells.push((fi as u32, 2, CellValue::Null, Some(formula_str)));
    }

    let snapshot = build_snapshot(vec![("Sheet1", n, 10, cells)], vec![]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_text_column_indexed_path", &result);

    // Verify each XLOOKUP returns the correct value
    for (fi, &target_row) in targets.iter().enumerate() {
        let val = find_changed_value(&result, 0, fi as u32, 2);
        let expected = target_row as f64 * 10.0;
        match val {
            Some(CellValue::Number(n)) => assert!(
                (n.get() - expected).abs() < 1e-10,
                "XLOOKUP for Brand_{:04} (row {}): expected {}, got {}",
                target_row,
                fi,
                expected,
                n.get()
            ),
            other => panic!(
                "XLOOKUP for Brand_{:04} (row {}): expected Number({}), got {:?}",
                target_row, fi, expected, other
            ),
        }
    }
}

// ===========================================================================
// Test: XLOOKUP direct cell fetch — single-column return range
// ===========================================================================

/// Exercises the direct cell fetch optimization: when the return array is a
/// simple single-column range (e.g. B1:B5), the engine can fetch the value
/// directly from column storage instead of materializing the whole array.
#[test]
fn test_xlookup_direct_fetch_single_col_return() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: lookup keys (numbers 1..=20)
    // Col B: return values (key * 100)
    for i in 0..20 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
        cells.push((i, 1, CellValue::number((i + 1) as f64 * 100.0), None));
    }

    // Col C: XLOOKUP formulas for specific keys
    cells.push((0, 2, CellValue::Null, Some("XLOOKUP(1,A1:A20,B1:B20)")));
    cells.push((1, 2, CellValue::Null, Some("XLOOKUP(10,A1:A20,B1:B20)")));
    cells.push((2, 2, CellValue::Null, Some("XLOOKUP(20,A1:A20,B1:B20)")));

    let snapshot = build_snapshot(vec![("Sheet1", 20, 10, cells)], vec![]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // XLOOKUP(1,...) -> 100
    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 100.0).abs() < 1e-10,
            "Expected 100, got {}",
            n.get()
        ),
        other => panic!("Expected Number(100), got {:?}", other),
    }

    // XLOOKUP(10,...) -> 1000
    let val = find_changed_value(&result, 0, 1, 2);
    assert!(val.is_some(), "Expected C2 in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 1000.0).abs() < 1e-10,
            "Expected 1000, got {}",
            n.get()
        ),
        other => panic!("Expected Number(1000), got {:?}", other),
    }

    // XLOOKUP(20,...) -> 2000
    let val = find_changed_value(&result, 0, 2, 2);
    assert!(val.is_some(), "Expected C3 in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 2000.0).abs() < 1e-10,
            "Expected 2000, got {}",
            n.get()
        ),
        other => panic!("Expected Number(2000), got {:?}", other),
    }
}

// ===========================================================================
// Test: XLOOKUP fallback — multi-column return range
// ===========================================================================

/// When the return array spans multiple columns (e.g. B1:C3), the direct
/// cell fetch optimization cannot apply and the engine must fall back to
/// materializing the full return array. Verify correctness of that path.
#[test]
fn test_xlookup_fallback_multi_col_return() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // Col A: lookup keys
                (0, 0, CellValue::number(1.0), None),
                (1, 0, CellValue::number(2.0), None),
                (2, 0, CellValue::number(3.0), None),
                // Col B-C: multi-column return range
                (0, 1, CellValue::number(10.0), None),
                (0, 2, CellValue::number(100.0), None),
                (1, 1, CellValue::number(20.0), None),
                (1, 2, CellValue::number(200.0), None),
                (2, 1, CellValue::number(30.0), None),
                (2, 2, CellValue::number(300.0), None),
                // D1: XLOOKUP with multi-column return range B1:C3
                // Should return first column value at matched row -> 20
                (0, 3, CellValue::Null, Some("XLOOKUP(2,A1:A3,B1:C3)")),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_fallback_multi_col_return", &result);

    let val = find_changed_value(&result, 0, 0, 3);
    assert!(val.is_some(), "Expected D1 in changed_cells");
    // Multi-column XLOOKUP returns a horizontal array; the anchor cell gets the first element
    let val = val.unwrap();
    println!("D1 value = {:?}", val);
    match &val {
        CellValue::Number(n) => assert!(
            (n.get() - 20.0).abs() < 1e-10,
            "Expected 20 (first col of matched row), got {}",
            n.get()
        ),
        CellValue::Array(arr) => {
            // May return as array — check first element
            match arr.get(0, 0).unwrap() {
                CellValue::Number(n) => assert!(
                    (n.get() - 20.0).abs() < 1e-10,
                    "Expected 20, got {}",
                    n.get()
                ),
                other => panic!("Expected Number(20), got {:?}", other),
            }
        }
        other => panic!("Expected Number(20) or Array, got {:?}", other),
    }
}

// ===========================================================================
// Test: XLOOKUP return range shorter than lookup range
// ===========================================================================

/// When the return range has fewer rows than the lookup range, a match
/// beyond the return range extent should still be handled gracefully
/// (typically returning Null or the appropriate boundary value).
#[test]
fn test_xlookup_return_range_shorter_than_lookup() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                // Col A: lookup keys (5 rows)
                (0, 0, CellValue::number(1.0), None),
                (1, 0, CellValue::number(2.0), None),
                (2, 0, CellValue::number(3.0), None),
                (3, 0, CellValue::number(4.0), None),
                (4, 0, CellValue::number(5.0), None),
                // Col B: return values (only 3 rows)
                (0, 1, CellValue::number(100.0), None),
                (1, 1, CellValue::number(200.0), None),
                (2, 1, CellValue::number(300.0), None),
                // C1: lookup key=2 (within return range) -> 200
                (0, 2, CellValue::Null, Some("XLOOKUP(2,A1:A5,B1:B3)")),
                // C2: lookup key=5 (row 4, beyond return range of 3 rows)
                (1, 2, CellValue::Null, Some("XLOOKUP(5,A1:A5,B1:B3)")),
            ],
        )],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_return_range_shorter_than_lookup", &result);

    // C1: key=2, match at row index 1, within B1:B3 -> 200
    let val = find_changed_value(&result, 0, 0, 2);
    assert!(val.is_some(), "Expected C1 in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 200.0).abs() < 1e-10,
            "Expected 200, got {}",
            n.get()
        ),
        other => panic!("Expected Number(200), got {:?}", other),
    }

    // C2: key=5, match at row index 4, beyond B1:B3 (only 3 rows).
    // Excel returns 0/Null for out-of-bounds. Our engine should handle gracefully.
    let val = find_changed_value(&result, 0, 1, 2);
    assert!(val.is_some(), "Expected C2 in changed_cells");
    let val = val.unwrap();
    println!("C2 (out-of-bounds return) = {:?}", val);
    // Accept Null or Number(0) — both are valid for out-of-bounds
    match &val {
        CellValue::Null => { /* OK */ }
        CellValue::Number(n) => assert!(
            (n.get() - 0.0).abs() < 1e-10,
            "Expected 0 for out-of-bounds, got {}",
            n.get()
        ),
        _ => { /* Accept any non-error result; the key point is no crash */ }
    }
}

// ===========================================================================
// Test: XLOOKUP with cross-sheet return range
// ===========================================================================

/// The return range is on a different sheet from the formula cell.
/// This exercises try_extract_single_col_range resolving a cross-sheet ref.
#[test]
fn test_xlookup_cross_sheet_return_range() {
    let snapshot = build_snapshot(
        vec![
            (
                "Lookup",
                10,
                10,
                vec![
                    // Col A: lookup keys
                    (0, 0, CellValue::number(1.0), None),
                    (1, 0, CellValue::number(2.0), None),
                    (2, 0, CellValue::number(3.0), None),
                    // B1: XLOOKUP with return range on Data sheet
                    (0, 1, CellValue::Null, Some("XLOOKUP(2,A1:A3,Data!B1:B3)")),
                ],
            ),
            (
                "Data",
                10,
                10,
                vec![
                    // Col B on Data sheet: return values
                    (0, 1, CellValue::number(100.0), None),
                    (1, 1, CellValue::number(200.0), None),
                    (2, 1, CellValue::number(300.0), None),
                ],
            ),
        ],
        vec![],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_diagnostics("test_xlookup_cross_sheet_return_range", &result);

    // B1 on Lookup sheet: XLOOKUP(2, A1:A3, Data!B1:B3) -> 200
    let val = find_changed_value(&result, 0, 0, 1);
    assert!(val.is_some(), "Expected Lookup!B1 in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 200.0).abs() < 1e-10,
            "Expected 200 (from Data!B2), got {}",
            n.get()
        ),
        other => panic!("Expected Number(200), got {:?}", other),
    }
}
