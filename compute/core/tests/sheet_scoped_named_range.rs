//! Integration tests for sheet-scoped named range resolution.
//!
//! Verifies that `'SheetName'!NamedRange` syntax resolves correctly when
//! the named range is defined with sheet scope.
//!
//! Bug: `parse_ref_after_sheet` in the parser does not try to parse identifiers
//! after the `!` separator, so `'Sheet1'!MyName` fails to parse and returns #NAME?.
//!
//! Run:
//!   cargo test -p compute-core --test sheet_scoped_named_range -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use formula_types::{NamedRangeDef, Scope};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn find_value(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32) -> Option<CellValue> {
    let target = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target)
        .map(|cc| cc.value.clone())
}

fn assert_number(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: f64) {
    let val = find_value(result, sheet_idx, row, col);
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

fn assert_error(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: CellError) {
    let val = find_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Error(e, None)) => {
            assert_eq!(
                e, expected,
                "Cell ({},{},{}) expected {:?}, got {:?}",
                sheet_idx, row, col, expected, e
            );
        }
        Some(other) => panic!(
            "Cell ({},{},{}) expected Error({:?}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell ({},{},{}) not in changed_cells (expected Error({:?}))",
            sheet_idx, row, col, expected
        ),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Basic scenario: sheet-scoped named range referenced with sheet qualifier
/// on the SAME sheet. This is the exact pattern from bond_refi:
///   Named range "Settlement_Date" scoped to "Bond-Refinancing", refers to $F$19.
///   Formula on Bond-Refinancing: ='Bond-Refinancing'!Settlement_Date
///
/// Expected: resolves to the value in the named range's target cell.
/// Actual (bug): #NAME? because parser can't parse identifier after '!'.
#[test]
fn sheet_qualified_named_range_same_sheet() {
    let sheet_id_str = sheet_uuid(0);
    let sheet_id = cell_types::SheetId::from_uuid_str(&sheet_id_str).unwrap();

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str.clone(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![
                // A1 = 42 (the value the named range points to)
                CellData {
                    cell_id: cell_uuid(0, 0, 0),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(42.0.try_into().unwrap()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1 = 'Sheet1'!MyValue (sheet-qualified named range reference)
                CellData {
                    cell_id: cell_uuid(0, 0, 1),
                    row: 0,
                    col: 1,
                    value: CellValue::Null,
                    formula: Some("'Sheet1'!MyValue".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![
            // Sheet-scoped named range: MyValue on Sheet1, refers to Sheet1!$A$1
            NamedRangeDef::from_expression(
                "MyValue".to_string(),
                Scope::Sheet(sheet_id),
                "Sheet1!$A$1".to_string(),
            ),
        ],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== sheet_qualified_named_range_same_sheet ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // B1 should resolve to 42 (the value of A1 via the named range)
    assert_number(&result, 0, 0, 1, 42.0);
}

/// Sheet-scoped named range referenced WITHOUT qualifier (just the name).
/// This should work already — it's the baseline.
#[test]
fn unqualified_named_range_same_sheet() {
    let sheet_id_str = sheet_uuid(0);
    let sheet_id = cell_types::SheetId::from_uuid_str(&sheet_id_str).unwrap();

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str.clone(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![
                CellData {
                    cell_id: cell_uuid(0, 0, 0),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(100.0.try_into().unwrap()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1 = MyValue (unqualified — should find sheet-scoped name on same sheet)
                CellData {
                    cell_id: cell_uuid(0, 0, 1),
                    row: 0,
                    col: 1,
                    value: CellValue::Null,
                    formula: Some("MyValue".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_expression(
            "MyValue".to_string(),
            Scope::Sheet(sheet_id),
            "Sheet1!$A$1".to_string(),
        )],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== unqualified_named_range_same_sheet ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // B1 should resolve to 100
    assert_number(&result, 0, 0, 1, 100.0);
}

/// Cross-sheet scenario: formula on Sheet2 references a named range scoped to Sheet1
/// using 'Sheet1'!MyValue syntax.
///
/// In Excel, 'Sheet1'!MyName resolves the name in Sheet1's scope.
#[test]
fn sheet_qualified_named_range_cross_sheet() {
    let sheet1_id_str = sheet_uuid(0);
    let sheet2_id_str = sheet_uuid(1);
    let sheet1_id = cell_types::SheetId::from_uuid_str(&sheet1_id_str).unwrap();

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet1_id_str.clone(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![
                    // Sheet1!A1 = 77
                    CellData {
                        cell_id: cell_uuid(0, 0, 0),
                        row: 0,
                        col: 0,
                        value: CellValue::Number(77.0.try_into().unwrap()),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet2_id_str.clone(),
                name: "Sheet2".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![
                    // Sheet2!A1 = 'Sheet1'!MyValue (cross-sheet named range reference)
                    CellData {
                        cell_id: cell_uuid(1, 0, 0),
                        row: 0,
                        col: 0,
                        value: CellValue::Null,
                        formula: Some("'Sheet1'!MyValue".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
        ],
        named_ranges: vec![
            // Sheet-scoped named range on Sheet1
            NamedRangeDef::from_expression(
                "MyValue".to_string(),
                Scope::Sheet(sheet1_id),
                "Sheet1!$A$1".to_string(),
            ),
        ],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== sheet_qualified_named_range_cross_sheet ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Sheet2!A1 should resolve to 77 (Sheet1!A1 via Sheet1-scoped named range)
    assert_number(&result, 1, 0, 0, 77.0);
}

/// Named range with unquoted sheet name (no spaces): Sheet1!MyValue
#[test]
fn sheet_qualified_named_range_unquoted_sheet() {
    let sheet_id_str = sheet_uuid(0);
    let sheet_id = cell_types::SheetId::from_uuid_str(&sheet_id_str).unwrap();

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str.clone(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![
                CellData {
                    cell_id: cell_uuid(0, 0, 0),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(55.0.try_into().unwrap()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1 = Sheet1!MyValue (unquoted sheet name)
                CellData {
                    cell_id: cell_uuid(0, 0, 1),
                    row: 0,
                    col: 1,
                    value: CellValue::Null,
                    formula: Some("Sheet1!MyValue".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_expression(
            "MyValue".to_string(),
            Scope::Sheet(sheet_id),
            "Sheet1!$A$1".to_string(),
        )],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== sheet_qualified_named_range_unquoted_sheet ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // B1 should resolve to 55
    assert_number(&result, 0, 0, 1, 55.0);
}

/// Named range in a formula expression: =SUM('Sheet1'!MyValue, 10)
#[test]
fn sheet_qualified_named_range_in_expression() {
    let sheet_id_str = sheet_uuid(0);
    let sheet_id = cell_types::SheetId::from_uuid_str(&sheet_id_str).unwrap();

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str.clone(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![
                CellData {
                    cell_id: cell_uuid(0, 0, 0),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(30.0.try_into().unwrap()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1 = SUM('Sheet1'!MyValue, 10)
                CellData {
                    cell_id: cell_uuid(0, 0, 1),
                    row: 0,
                    col: 1,
                    value: CellValue::Null,
                    formula: Some("SUM('Sheet1'!MyValue, 10)".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_expression(
            "MyValue".to_string(),
            Scope::Sheet(sheet_id),
            "Sheet1!$A$1".to_string(),
        )],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== sheet_qualified_named_range_in_expression ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // B1 = SUM(30, 10) = 40
    assert_number(&result, 0, 0, 1, 40.0);
}

/// Workbook-scoped named range with sheet qualifier should also work.
/// In Excel, 'Sheet1'!WbName resolves a workbook-scoped name too.
#[test]
fn sheet_qualified_workbook_scoped_named_range() {
    let sheet_id_str = sheet_uuid(0);

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str.clone(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![
                CellData {
                    cell_id: cell_uuid(0, 0, 0),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(99.0.try_into().unwrap()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1 = 'Sheet1'!GlobalName (workbook-scoped, but with sheet qualifier)
                CellData {
                    cell_id: cell_uuid(0, 0, 1),
                    row: 0,
                    col: 1,
                    value: CellValue::Null,
                    formula: Some("'Sheet1'!GlobalName".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_expression(
            "GlobalName".to_string(),
            Scope::Workbook,
            "Sheet1!$A$1".to_string(),
        )],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== sheet_qualified_workbook_scoped_named_range ===");
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // B1 should resolve to 99
    assert_number(&result, 0, 0, 1, 99.0);
}
