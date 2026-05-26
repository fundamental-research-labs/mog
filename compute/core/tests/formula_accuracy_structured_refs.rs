//! Integration tests for formula accuracy issue: structured table references.
//!
//! Problem: Complex IF formulas with structured table references like
//! `Deals8[[#This Row],[Exit CR]]` produce `#VALUE!` errors when Excel returns `0`.
//! The `[#This Row]` specifier requires knowing the current cell's row to resolve.
//!
//! The resolution path:
//!   1. Parser produces `ASTNode::StructuredRef`
//!   2. Evaluator calls `ctx.resolve_structured_ref(ref_)`
//!   3. Which calls `mirror.get_table(&ref_.table_name)` (case-sensitive!)
//!   4. Then `mirror.resolve_position(&current_cell_id)` to get row
//!   5. Then `resolve_ranges_from_table_def(ref_, table_def, current_row)`
//!   6. Finally fetches cell values for the resolved grid positions
//!
//! Run:
//!   cargo test -p compute-core --test formula_accuracy_structured_refs -- --nocapture

use cell_types::SheetId;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use formula_types::TableDef;
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/// Deterministic UUID-like string from sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (row, col, sheet_idx).
fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a `SheetId` that matches `sheet_uuid(idx)`.
fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).unwrap()
}

/// Build a `WorkbookSnapshot` with a single sheet and a table.
/// `table_name`: name of the table
/// `col_names`: column headers for the table
/// `data_rows`: each inner vec is one row of data values (len must match col_names)
/// `formula_col`: optional column index (within table) that contains formulas instead of values.
///                If set, `data_rows[r][formula_col]` is treated as a formula string.
///                For simplicity, formulas and values are passed separately.
///
/// Returns (snapshot, sheet_idx=0)
fn build_table_snapshot(
    sheet_name: &str,
    table_name: &str,
    col_names: &[&str],
    data_rows: Vec<Vec<CellValue>>,
    formula_cells: Vec<(u32, u32, &str)>, // (data_row_offset, col_offset, formula)
) -> WorkbookSnapshot {
    let si: u32 = 0;
    let num_cols = col_names.len() as u32;
    let num_data_rows = data_rows.len() as u32;
    // Row 0 = header, rows 1..=num_data_rows = data
    let total_rows = 1 + num_data_rows;

    let mut cells: Vec<CellData> = Vec::new();

    // Header row (row 0)
    for (ci, col_name) in col_names.iter().enumerate() {
        cells.push(CellData {
            cell_id: cell_uuid(si, 0, ci as u32),
            row: 0,
            col: ci as u32,
            value: CellValue::Text(col_name.to_string().into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // Data rows (row 1..)
    for (ri, row_data) in data_rows.iter().enumerate() {
        let grid_row = ri as u32 + 1; // offset by 1 for header
        for (ci, val) in row_data.iter().enumerate() {
            cells.push(CellData {
                cell_id: cell_uuid(si, grid_row, ci as u32),
                row: grid_row,
                col: ci as u32,
                value: val.clone(),
                formula: None,
                identity_formula: None,
                array_ref: None,
            });
        }
    }

    // Override specific cells with formulas
    for (data_row_offset, col_offset, formula) in &formula_cells {
        let grid_row = data_row_offset + 1; // offset by 1 for header
        // Find existing cell and set its formula
        if let Some(cell) = cells
            .iter_mut()
            .find(|c| c.row == grid_row && c.col == *col_offset)
        {
            cell.formula = Some(formula.to_string());
            cell.value = CellValue::Null; // formula cells start with Null
        }
    }

    let table_def = TableDef {
        name: table_name.to_string(),
        sheet: sheet_id(si),
        start_row: 0, // includes header
        start_col: 0,
        end_row: total_rows - 1, // last data row
        end_col: num_cols - 1,
        columns: col_names.iter().map(|s| s.to_string()).collect(),
        has_headers: true,
        has_totals: false,
    };

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(si),
            name: sheet_name.to_string(),
            rows: total_rows + 10, // some extra space
            cols: num_cols + 5,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![table_def],
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

/// Find an error for a specific (sheet_index, row, col) in the RecalcResult.
fn find_error(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<String> {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .errors
        .iter()
        .find(|e| e.cell_id == target_cell_id)
        .map(|e| e.error.clone())
}

/// Print diagnostics for a RecalcResult.
fn print_result(label: &str, result: &compute_core::RecalcResult) {
    println!("\n=== {} ===", label);
    println!("changed_cells: {}", result.changed_cells.len());
    for cc in &result.changed_cells {
        println!("  cell_id={} value={:?}", cc.cell_id, cc.value);
    }
    if !result.errors.is_empty() {
        println!("errors: {}", result.errors.len());
        for e in &result.errors {
            println!("  cell_id={} error={}", e.cell_id, e.error);
        }
    }
}

// ---------------------------------------------------------------------------
// Test 1: Basic structured ref with #This Row
// ---------------------------------------------------------------------------

/// Table with numeric columns. Formula in data row: `Deals8[[#This Row],[Col1]]`
/// should return the value in Col1 of that row.
#[test]
fn test_structured_ref_this_row_basic() {
    // Table "Deals8":
    //   Row 0 (header): Exit CR | Entry CR | Result
    //   Row 1 (data):   10.5    | 8.3      | =Deals8[[#This Row],[Exit CR]]
    let snapshot = build_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![vec![
            CellValue::number(10.5),
            CellValue::number(8.3),
            CellValue::Null,
        ]],
        vec![(0, 2, "Deals8[[#This Row],[Exit CR]]")],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_this_row_basic", &result);

    // The formula is in grid row 1 (data row 0), col 2
    let val = find_changed_value(&result, 0, 1, 2);
    let err = find_error(&result, 0, 1, 2);

    // Should NOT produce an error
    assert!(err.is_none(), "Structured ref produced error: {:?}", err);

    assert!(
        val.is_some(),
        "Expected Result cell to appear in changed_cells"
    );
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 10.5).abs() < 1e-10,
            "Expected 10.5, got {}",
            n.get()
        ),
        // If the engine returns a 1x1 array, unwrap it
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1, "Expected 1 row in array");
            assert_eq!(arr.cols(), 1, "Expected 1 col in array");
            match arr.get(0, 0).unwrap() {
                CellValue::Number(n) => assert!(
                    (n.get() - 10.5).abs() < 1e-10,
                    "Expected 10.5 inside array, got {}",
                    n.get()
                ),
                other => panic!("Expected Number(10.5) inside array, got {:?}", other),
            }
        }
        other => panic!("Expected Number(10.5), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 2: Structured ref subtraction
// ---------------------------------------------------------------------------

/// `Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]]` should compute the difference.
#[test]
fn test_structured_ref_this_row_subtraction() {
    let snapshot = build_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![vec![
            CellValue::number(10.5),
            CellValue::number(8.3),
            CellValue::Null,
        ]],
        vec![(
            0,
            2,
            "Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]]",
        )],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_this_row_subtraction", &result);

    let val = find_changed_value(&result, 0, 1, 2);
    let err = find_error(&result, 0, 1, 2);

    assert!(
        err.is_none(),
        "Subtraction formula produced error: {:?}",
        err
    );

    assert!(val.is_some(), "Expected Result cell in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => {
            let expected = 10.5 - 8.3;
            assert!(
                (n.get() - expected).abs() < 1e-10,
                "Expected {}, got {}",
                expected,
                n.get()
            );
        }
        other => panic!("Expected Number({}), got {:?}", 10.5 - 8.3, other),
    }
}

// ---------------------------------------------------------------------------
// Test 3: IF with empty check on structured ref
// ---------------------------------------------------------------------------

/// Full pattern: `IF(Deals8[[#This Row],[Exit CR]]="", 0, Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])`
/// When Exit CR is empty, should return 0.
/// When Exit CR has a number, should return the difference.
#[test]
fn test_structured_ref_with_if_empty_check() {
    let snapshot = build_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![
            // Row 0: Exit CR is empty -> result should be 0
            vec![CellValue::Null, CellValue::number(5.0), CellValue::Null],
            // Row 1: Exit CR is numeric -> result should be 10.5 - 8.3 = 2.2
            vec![
                CellValue::number(10.5),
                CellValue::number(8.3),
                CellValue::Null,
            ],
        ],
        vec![
            (
                0,
                2,
                "IF(Deals8[[#This Row],[Exit CR]]=\"\",0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])",
            ),
            (
                1,
                2,
                "IF(Deals8[[#This Row],[Exit CR]]=\"\",0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])",
            ),
        ],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_with_if_empty_check", &result);

    // Row 0 (grid row 1): Exit CR is empty -> should return 0
    let val_r0 = find_changed_value(&result, 0, 1, 2);
    let err_r0 = find_error(&result, 0, 1, 2);
    assert!(
        err_r0.is_none(),
        "Row 0 formula produced error: {:?}",
        err_r0
    );
    assert!(val_r0.is_some(), "Expected row 0 Result in changed_cells");
    match val_r0.unwrap() {
        CellValue::Number(n) => assert!(
            n.get().abs() < 1e-10,
            "Expected 0 for empty Exit CR, got {}",
            n.get()
        ),
        other => panic!("Expected Number(0) for empty Exit CR, got {:?}", other),
    }

    // Row 1 (grid row 2): Exit CR = 10.5 -> should return 10.5 - 8.3 = 2.2
    let val_r1 = find_changed_value(&result, 0, 2, 2);
    let err_r1 = find_error(&result, 0, 2, 2);
    assert!(
        err_r1.is_none(),
        "Row 1 formula produced error: {:?}",
        err_r1
    );
    assert!(val_r1.is_some(), "Expected row 1 Result in changed_cells");
    match val_r1.unwrap() {
        CellValue::Number(n) => {
            let expected = 10.5 - 8.3;
            assert!(
                (n.get() - expected).abs() < 1e-10,
                "Expected {}, got {}",
                expected,
                n.get()
            );
        }
        other => panic!("Expected Number(2.2), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 4: IF with OR conditions and structured refs
// ---------------------------------------------------------------------------

/// `IF(OR(Deals8[[#This Row],[Exit CR]]="", Deals8[[#This Row],[Entry CR]]=""), 0, ...)`
/// Tests OR with multiple structured reference conditions.
#[test]
fn test_structured_ref_with_or_conditions() {
    let snapshot = build_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![
            // Row 0: Both have values -> should compute difference
            vec![
                CellValue::number(10.0),
                CellValue::number(6.0),
                CellValue::Null,
            ],
            // Row 1: Exit CR empty -> should return 0
            vec![CellValue::Null, CellValue::number(5.0), CellValue::Null],
            // Row 2: Entry CR empty -> should return 0
            vec![CellValue::number(7.0), CellValue::Null, CellValue::Null],
            // Row 3: Both empty -> should return 0
            vec![CellValue::Null, CellValue::Null, CellValue::Null],
        ],
        vec![
            (
                0,
                2,
                "IF(OR(Deals8[[#This Row],[Exit CR]]=\"\",Deals8[[#This Row],[Entry CR]]=\"\"),0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])",
            ),
            (
                1,
                2,
                "IF(OR(Deals8[[#This Row],[Exit CR]]=\"\",Deals8[[#This Row],[Entry CR]]=\"\"),0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])",
            ),
            (
                2,
                2,
                "IF(OR(Deals8[[#This Row],[Exit CR]]=\"\",Deals8[[#This Row],[Entry CR]]=\"\"),0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])",
            ),
            (
                3,
                2,
                "IF(OR(Deals8[[#This Row],[Exit CR]]=\"\",Deals8[[#This Row],[Entry CR]]=\"\"),0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])",
            ),
        ],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_with_or_conditions", &result);

    // Row 0 (grid row 1): Both values present -> 10.0 - 6.0 = 4.0
    let val_r0 = find_changed_value(&result, 0, 1, 2);
    let err_r0 = find_error(&result, 0, 1, 2);
    assert!(err_r0.is_none(), "Row 0 error: {:?}", err_r0);
    assert!(val_r0.is_some(), "Expected row 0 Result in changed_cells");
    match val_r0.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 4.0).abs() < 1e-10,
            "Expected 4.0, got {}",
            n.get()
        ),
        other => panic!("Expected Number(4.0), got {:?}", other),
    }

    // Row 1 (grid row 2): Exit CR empty -> 0
    let val_r1 = find_changed_value(&result, 0, 2, 2);
    let err_r1 = find_error(&result, 0, 2, 2);
    assert!(err_r1.is_none(), "Row 1 error: {:?}", err_r1);
    assert!(val_r1.is_some(), "Expected row 1 Result in changed_cells");
    match val_r1.unwrap() {
        CellValue::Number(n) => assert!(
            n.get().abs() < 1e-10,
            "Expected 0 for empty Exit CR, got {}",
            n.get()
        ),
        other => panic!("Expected Number(0) for empty Exit CR, got {:?}", other),
    }

    // Row 2 (grid row 3): Entry CR empty -> 0
    let val_r2 = find_changed_value(&result, 0, 3, 2);
    let err_r2 = find_error(&result, 0, 3, 2);
    assert!(err_r2.is_none(), "Row 2 error: {:?}", err_r2);
    assert!(val_r2.is_some(), "Expected row 2 Result in changed_cells");
    match val_r2.unwrap() {
        CellValue::Number(n) => assert!(
            n.get().abs() < 1e-10,
            "Expected 0 for empty Entry CR, got {}",
            n.get()
        ),
        other => panic!("Expected Number(0) for empty Entry CR, got {:?}", other),
    }

    // Row 3 (grid row 4): Both empty -> 0
    let val_r3 = find_changed_value(&result, 0, 4, 2);
    let err_r3 = find_error(&result, 0, 4, 2);
    assert!(err_r3.is_none(), "Row 3 error: {:?}", err_r3);
    assert!(val_r3.is_some(), "Expected row 3 Result in changed_cells");
    match val_r3.unwrap() {
        CellValue::Number(n) => assert!(
            n.get().abs() < 1e-10,
            "Expected 0 for both empty, got {}",
            n.get()
        ),
        other => panic!("Expected Number(0) for both empty, got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 5: ISNUMBER with structured refs
// ---------------------------------------------------------------------------

/// `ISNUMBER(Deals8[[#This Row],[Exit CR]])` should return TRUE when cell has a number,
/// FALSE when empty/text.
#[test]
fn test_structured_ref_isnumber() {
    let snapshot = build_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "IsNum"],
        vec![
            // Row 0: Exit CR is numeric
            vec![CellValue::number(10.5), CellValue::Null],
            // Row 1: Exit CR is empty
            vec![CellValue::Null, CellValue::Null],
            // Row 2: Exit CR is text
            vec![CellValue::Text("hello".into()), CellValue::Null],
        ],
        vec![
            (0, 1, "ISNUMBER(Deals8[[#This Row],[Exit CR]])"),
            (1, 1, "ISNUMBER(Deals8[[#This Row],[Exit CR]])"),
            (2, 1, "ISNUMBER(Deals8[[#This Row],[Exit CR]])"),
        ],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_isnumber", &result);

    // Row 0 (grid row 1): numeric -> TRUE
    let val_r0 = find_changed_value(&result, 0, 1, 1);
    let err_r0 = find_error(&result, 0, 1, 1);
    assert!(err_r0.is_none(), "Row 0 error: {:?}", err_r0);
    assert!(val_r0.is_some(), "Expected row 0 IsNum in changed_cells");
    match val_r0.unwrap() {
        CellValue::Boolean(b) => assert!(b, "Expected TRUE for number, got FALSE"),
        other => panic!("Expected Boolean(true), got {:?}", other),
    }

    // Row 1 (grid row 2): empty -> FALSE
    let val_r1 = find_changed_value(&result, 0, 2, 1);
    let err_r1 = find_error(&result, 0, 2, 1);
    assert!(err_r1.is_none(), "Row 1 error: {:?}", err_r1);
    assert!(val_r1.is_some(), "Expected row 1 IsNum in changed_cells");
    match val_r1.unwrap() {
        CellValue::Boolean(b) => assert!(!b, "Expected FALSE for empty, got TRUE"),
        other => panic!("Expected Boolean(false), got {:?}", other),
    }

    // Row 2 (grid row 3): text -> FALSE
    let val_r2 = find_changed_value(&result, 0, 3, 1);
    let err_r2 = find_error(&result, 0, 3, 1);
    assert!(err_r2.is_none(), "Row 2 error: {:?}", err_r2);
    assert!(val_r2.is_some(), "Expected row 2 IsNum in changed_cells");
    match val_r2.unwrap() {
        CellValue::Boolean(b) => assert!(!b, "Expected FALSE for text, got TRUE"),
        other => panic!("Expected Boolean(false), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 6: Multiple data rows each resolving #This Row independently
// ---------------------------------------------------------------------------

/// Multiple data rows in the table, each with a formula using #This Row.
/// Each row should resolve to its own row's data.
#[test]
fn test_structured_ref_multiple_rows() {
    let snapshot = build_table_snapshot(
        "Sheet1",
        "Data1",
        &["Value", "Double"],
        vec![
            vec![CellValue::number(1.0), CellValue::Null],
            vec![CellValue::number(2.0), CellValue::Null],
            vec![CellValue::number(3.0), CellValue::Null],
            vec![CellValue::number(4.0), CellValue::Null],
            vec![CellValue::number(5.0), CellValue::Null],
        ],
        vec![
            (0, 1, "Data1[[#This Row],[Value]]*2"),
            (1, 1, "Data1[[#This Row],[Value]]*2"),
            (2, 1, "Data1[[#This Row],[Value]]*2"),
            (3, 1, "Data1[[#This Row],[Value]]*2"),
            (4, 1, "Data1[[#This Row],[Value]]*2"),
        ],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_multiple_rows", &result);

    for i in 0..5u32 {
        let grid_row = i + 1;
        let expected = (i as f64 + 1.0) * 2.0;
        let val = find_changed_value(&result, 0, grid_row, 1);
        let err = find_error(&result, 0, grid_row, 1);
        assert!(err.is_none(), "Row {} produced error: {:?}", i, err);
        assert!(val.is_some(), "Expected row {} Double in changed_cells", i);
        match val.unwrap() {
            CellValue::Number(n) => assert!(
                (n.get() - expected).abs() < 1e-10,
                "Row {}: expected {}, got {}",
                i,
                expected,
                n.get()
            ),
            other => panic!("Row {}: expected Number({}), got {:?}", i, expected, other),
        }
    }
}

// ---------------------------------------------------------------------------
// Test 7: Column range (non-ThisRow)
// ---------------------------------------------------------------------------

/// `Data1[[Col1]:[Col3]]` — range across multiple columns.
/// This should return the data range for columns Col1 through Col3.
#[test]
fn test_structured_ref_column_range() {
    let snapshot = build_table_snapshot(
        "Sheet1",
        "Data1",
        &["Col1", "Col2", "Col3", "SumResult"],
        vec![vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
            CellValue::Null,
        ]],
        vec![
            // SUM of the three columns in this row
            (0, 3, "SUM(Data1[[#This Row],[Col1]:[Col3]])"),
        ],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_column_range", &result);

    let val = find_changed_value(&result, 0, 1, 3);
    let err = find_error(&result, 0, 1, 3);
    assert!(err.is_none(), "Column range formula error: {:?}", err);
    assert!(val.is_some(), "Expected SumResult in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 6.0).abs() < 1e-10,
            "Expected SUM(1,2,3) = 6, got {}",
            n.get()
        ),
        other => panic!("Expected Number(6), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 8: @ shorthand syntax
// ---------------------------------------------------------------------------

/// `Data1[@Col1]` is equivalent to `Data1[[#This Row],[Col1]]`. Test this shorthand.
#[test]
fn test_structured_ref_at_syntax() {
    let snapshot = build_table_snapshot(
        "Sheet1",
        "Data1",
        &["Col1", "Result"],
        vec![vec![CellValue::number(42.0), CellValue::Null]],
        vec![(0, 1, "Data1[@Col1]")],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_at_syntax", &result);

    let val = find_changed_value(&result, 0, 1, 1);
    let err = find_error(&result, 0, 1, 1);
    assert!(err.is_none(), "@ syntax formula error: {:?}", err);
    assert!(val.is_some(), "Expected Result in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 42.0).abs() < 1e-10,
            "Expected 42, got {}",
            n.get()
        ),
        CellValue::Array(arr) => {
            // Unwrap 1x1 array
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 1);
            match arr.get(0, 0).unwrap() {
                CellValue::Number(n) => assert!(
                    (n.get() - 42.0).abs() < 1e-10,
                    "Expected 42 inside array, got {}",
                    n.get()
                ),
                other => panic!("Expected Number(42) inside array, got {:?}", other),
            }
        }
        other => panic!("Expected Number(42), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 9: Case-insensitive table name and column name matching
// ---------------------------------------------------------------------------

/// Table name and column names should match case-insensitively.
/// Note: `get_table` in mirror uses exact match, which may cause failures
/// if the formula has different casing than the table definition.
#[test]
fn test_structured_ref_case_insensitive() {
    // Table defined as "Deals8" with column "Exit CR"
    // Formula references "deals8[[#This Row],[exit cr]]" (all lowercase)
    let snapshot = build_table_snapshot(
        "Sheet1",
        "Deals8",
        &["Exit CR", "Result"],
        vec![vec![CellValue::number(99.0), CellValue::Null]],
        vec![
            // Use mixed/lowercase in the formula
            (0, 1, "deals8[[#This Row],[exit cr]]"),
        ],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_case_insensitive", &result);

    let val = find_changed_value(&result, 0, 1, 1);
    let err = find_error(&result, 0, 1, 1);

    // This test documents the expected behavior: case-insensitive matching.
    // If the engine fails here, it means `get_table` is doing a case-sensitive
    // comparison, which is a bug.
    if err.is_some() {
        println!(
            "BUG: Case-insensitive table lookup failed. Error: {:?}",
            err
        );
        println!(
            "The mirror's get_table() uses exact match (t.name == name), \
             but should use case-insensitive matching to match Excel behavior."
        );
    }

    // Excel resolves table names case-insensitively.
    // If this fails, it documents the case-sensitivity bug.
    assert!(
        err.is_none(),
        "Case-insensitive table lookup should work. Got error: {:?}. \
         This indicates get_table() in mirror/mod.rs does case-sensitive matching.",
        err
    );
    assert!(val.is_some(), "Expected Result in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 99.0).abs() < 1e-10,
            "Expected 99, got {}",
            n.get()
        ),
        CellValue::Array(arr) if arr.rows() == 1 && arr.cols() == 1 => {
            match arr.get(0, 0).unwrap() {
                CellValue::Number(n) => assert!(
                    (n.get() - 99.0).abs() < 1e-10,
                    "Expected 99, got {}",
                    n.get()
                ),
                other => panic!("Expected Number(99), got {:?}", other),
            }
        }
        other => panic!("Expected Number(99), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 10: Full corpus pattern (the exact formula from the bug report)
// ---------------------------------------------------------------------------

/// The exact formula from the corpus that produces #VALUE! but Excel returns 0:
/// ```
/// IF(OR(Deals8[[#This Row],[Exit CR]]="",Deals8[[#This Row],[Entry CR]]="",
///       NOT(ISNUMBER(Deals8[[#This Row],[Exit CR]])),NOT(ISNUMBER(Deals8[[#This Row],[Entry CR]]))),
///    0,
///    Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])
/// ```
/// With numeric values in both columns, should return the difference.
/// With empty Exit CR, should return 0.
#[test]
fn test_structured_ref_full_corpus_pattern() {
    let formula = concat!(
        "IF(OR(",
        "Deals8[[#This Row],[Exit CR]]=\"\",",
        "Deals8[[#This Row],[Entry CR]]=\"\",",
        "NOT(ISNUMBER(Deals8[[#This Row],[Exit CR]])),",
        "NOT(ISNUMBER(Deals8[[#This Row],[Entry CR]]))",
        "),0,",
        "Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])"
    );

    let snapshot = build_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![
            // Row 0: Both numeric -> should return 10.5 - 8.3 = 2.2
            vec![
                CellValue::number(10.5),
                CellValue::number(8.3),
                CellValue::Null,
            ],
            // Row 1: Exit CR empty -> should return 0
            vec![CellValue::Null, CellValue::number(5.0), CellValue::Null],
            // Row 2: Entry CR empty -> should return 0
            vec![CellValue::number(7.0), CellValue::Null, CellValue::Null],
            // Row 3: Both empty -> should return 0
            vec![CellValue::Null, CellValue::Null, CellValue::Null],
            // Row 4: Exit CR is text -> NOT(ISNUMBER) = TRUE -> should return 0
            vec![
                CellValue::Text("N/A".into()),
                CellValue::number(3.0),
                CellValue::Null,
            ],
        ],
        vec![
            (0, 2, formula),
            (1, 2, formula),
            (2, 2, formula),
            (3, 2, formula),
            (4, 2, formula),
        ],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    print_result("test_structured_ref_full_corpus_pattern", &result);

    // Row 0 (grid row 1): Both numeric -> 10.5 - 8.3 = 2.2
    {
        let val = find_changed_value(&result, 0, 1, 2);
        let err = find_error(&result, 0, 1, 2);
        assert!(
            err.is_none(),
            "Row 0 (both numeric) produced error: {:?}. This is the bug: \
             structured ref IF formula returns #VALUE! instead of computing.",
            err
        );
        assert!(val.is_some(), "Expected row 0 Result in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => {
                let expected = 10.5 - 8.3;
                assert!(
                    (n.get() - expected).abs() < 1e-10,
                    "Row 0: expected {}, got {}",
                    expected,
                    n.get()
                );
            }
            CellValue::Error(e, _) => {
                panic!(
                    "Row 0: Got error {:?} instead of numeric result. \
                     This is the #VALUE! bug from the corpus.",
                    e
                );
            }
            other => panic!("Row 0: expected Number(2.2), got {:?}", other),
        }
    }

    // Row 1 (grid row 2): Exit CR empty -> 0
    {
        let val = find_changed_value(&result, 0, 2, 2);
        let err = find_error(&result, 0, 2, 2);
        assert!(
            err.is_none(),
            "Row 1 (Exit CR empty) produced error: {:?}",
            err
        );
        assert!(val.is_some(), "Expected row 1 Result in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => {
                assert!(n.get().abs() < 1e-10, "Row 1: expected 0, got {}", n.get())
            }
            CellValue::Error(e, _) => {
                panic!(
                    "Row 1: Got error {:?} instead of 0. \
                     This is the #VALUE! bug from the corpus.",
                    e
                );
            }
            other => panic!("Row 1: expected Number(0), got {:?}", other),
        }
    }

    // Row 2 (grid row 3): Entry CR empty -> 0
    {
        let val = find_changed_value(&result, 0, 3, 2);
        let err = find_error(&result, 0, 3, 2);
        assert!(
            err.is_none(),
            "Row 2 (Entry CR empty) produced error: {:?}",
            err
        );
        assert!(val.is_some(), "Expected row 2 Result in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => {
                assert!(n.get().abs() < 1e-10, "Row 2: expected 0, got {}", n.get())
            }
            CellValue::Error(e, _) => {
                panic!(
                    "Row 2: Got error {:?} instead of 0. \
                     This is the #VALUE! bug from the corpus.",
                    e
                );
            }
            other => panic!("Row 2: expected Number(0), got {:?}", other),
        }
    }

    // Row 3 (grid row 4): Both empty -> 0
    {
        let val = find_changed_value(&result, 0, 4, 2);
        let err = find_error(&result, 0, 4, 2);
        assert!(
            err.is_none(),
            "Row 3 (both empty) produced error: {:?}",
            err
        );
        assert!(val.is_some(), "Expected row 3 Result in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => {
                assert!(n.get().abs() < 1e-10, "Row 3: expected 0, got {}", n.get())
            }
            CellValue::Error(e, _) => {
                panic!(
                    "Row 3: Got error {:?} instead of 0. \
                     This is the #VALUE! bug from the corpus.",
                    e
                );
            }
            other => panic!("Row 3: expected Number(0), got {:?}", other),
        }
    }

    // Row 4 (grid row 5): Exit CR is text "N/A" -> NOT(ISNUMBER) = TRUE -> 0
    {
        let val = find_changed_value(&result, 0, 5, 2);
        let err = find_error(&result, 0, 5, 2);
        assert!(
            err.is_none(),
            "Row 4 (text Exit CR) produced error: {:?}",
            err
        );
        assert!(val.is_some(), "Expected row 4 Result in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => {
                assert!(n.get().abs() < 1e-10, "Row 4: expected 0, got {}", n.get())
            }
            CellValue::Error(e, _) => {
                panic!(
                    "Row 4: Got error {:?} instead of 0. \
                     This is the #VALUE! bug from the corpus.",
                    e
                );
            }
            other => panic!("Row 4: expected Number(0), got {:?}", other),
        }
    }
}

// ---------------------------------------------------------------------------
// Test 11: SUMIF with full-column structured reference (non-ThisRow)
// ---------------------------------------------------------------------------

/// `SUMIF(Deals[Sponsor], "Alice", Deals[Amount])` should sum Amount where Sponsor="Alice".
/// This tests the case where structured refs resolve to full column arrays (not #This Row).
#[test]
fn test_sumif_with_structured_ref_column() {
    // Table "Deals":
    //   Row 0 (header): Sponsor | Amount
    //   Row 1 (data):   Alice   | 100
    //   Row 2 (data):   Bob     | 200
    //   Row 3 (data):   Alice   | 300
    //   Row 4 (data):   Carol   | 400
    //
    // Formula outside table: =SUMIF(Deals[Sponsor],"Alice",Deals[Amount])
    // Expected: 100 + 300 = 400

    let si: u32 = 0;
    let num_cols = 2u32;
    let num_data_rows = 4u32;
    let total_rows = 1 + num_data_rows; // header + data

    let mut cells: Vec<CellData> = Vec::new();

    // Header row (row 0)
    cells.push(CellData {
        cell_id: cell_uuid(si, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::Text("Sponsor".into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    cells.push(CellData {
        cell_id: cell_uuid(si, 0, 1),
        row: 0,
        col: 1,
        value: CellValue::Text("Amount".into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });

    // Data rows
    let data = vec![
        ("Alice", 100.0),
        ("Bob", 200.0),
        ("Alice", 300.0),
        ("Carol", 400.0),
    ];
    for (ri, (sponsor, amount)) in data.iter().enumerate() {
        let grid_row = ri as u32 + 1;
        cells.push(CellData {
            cell_id: cell_uuid(si, grid_row, 0),
            row: grid_row,
            col: 0,
            value: CellValue::Text(sponsor.to_string().into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        cells.push(CellData {
            cell_id: cell_uuid(si, grid_row, 1),
            row: grid_row,
            col: 1,
            value: CellValue::number(*amount),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // Formula cell outside the table (row 6, col 0)
    cells.push(CellData {
        cell_id: cell_uuid(si, 6, 0),
        row: 6,
        col: 0,
        value: CellValue::Null,
        formula: Some(r#"SUMIF(Deals[Sponsor],"Alice",Deals[Amount])"#.to_string()),
        identity_formula: None,
        array_ref: None,
    });

    // COUNTIF formula (row 7, col 0)
    cells.push(CellData {
        cell_id: cell_uuid(si, 7, 0),
        row: 7,
        col: 0,
        value: CellValue::Null,
        formula: Some(r#"COUNTIF(Deals[Sponsor],"Alice")"#.to_string()),
        identity_formula: None,
        array_ref: None,
    });

    // AVERAGEIF formula (row 8, col 0)
    cells.push(CellData {
        cell_id: cell_uuid(si, 8, 0),
        row: 8,
        col: 0,
        value: CellValue::Null,
        formula: Some(r#"AVERAGEIF(Deals[Sponsor],"Alice",Deals[Amount])"#.to_string()),
        identity_formula: None,
        array_ref: None,
    });

    let table_def = TableDef {
        name: "Deals".to_string(),
        sheet: sheet_id(si),
        start_row: 0,
        start_col: 0,
        end_row: total_rows - 1, // 4
        end_col: num_cols - 1,   // 1
        columns: vec!["Sponsor".to_string(), "Amount".to_string()],
        has_headers: true,
        has_totals: false,
    };

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(si),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![table_def],
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
    print_result("test_sumif_with_structured_ref_column", &result);

    // SUMIF: sum Amount where Sponsor="Alice" -> 100 + 300 = 400
    {
        let val = find_changed_value(&result, 0, 6, 0);
        let err = find_error(&result, 0, 6, 0);
        println!("SUMIF: val={:?}, err={:?}", val, err);
        assert!(err.is_none(), "SUMIF produced error: {:?}", err);
        assert!(val.is_some(), "SUMIF not in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => assert!(
                (n.get() - 400.0).abs() < 1e-10,
                "SUMIF: expected 400, got {}",
                n.get()
            ),
            CellValue::Error(e, _) => panic!("SUMIF returned error: {:?}", e),
            other => panic!("SUMIF: expected Number(400), got {:?}", other),
        }
    }

    // COUNTIF: count where Sponsor="Alice" -> 2
    {
        let val = find_changed_value(&result, 0, 7, 0);
        let err = find_error(&result, 0, 7, 0);
        println!("COUNTIF: val={:?}, err={:?}", val, err);
        assert!(err.is_none(), "COUNTIF produced error: {:?}", err);
        assert!(val.is_some(), "COUNTIF not in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => assert!(
                (n.get() - 2.0).abs() < 1e-10,
                "COUNTIF: expected 2, got {}",
                n.get()
            ),
            CellValue::Error(e, _) => panic!("COUNTIF returned error: {:?}", e),
            other => panic!("COUNTIF: expected Number(2), got {:?}", other),
        }
    }

    // AVERAGEIF: average Amount where Sponsor="Alice" -> (100+300)/2 = 200
    {
        let val = find_changed_value(&result, 0, 8, 0);
        let err = find_error(&result, 0, 8, 0);
        println!("AVERAGEIF: val={:?}, err={:?}", val, err);
        assert!(err.is_none(), "AVERAGEIF produced error: {:?}", err);
        assert!(val.is_some(), "AVERAGEIF not in changed_cells");
        match val.unwrap() {
            CellValue::Number(n) => assert!(
                (n.get() - 200.0).abs() < 1e-10,
                "AVERAGEIF: expected 200, got {}",
                n.get()
            ),
            CellValue::Error(e, _) => panic!("AVERAGEIF returned error: {:?}", e),
            other => panic!("AVERAGEIF: expected Number(200), got {:?}", other),
        }
    }
}

// ---------------------------------------------------------------------------
// Test 12: SUMIF with cross-sheet structured reference
// ---------------------------------------------------------------------------

/// Table on Sheet1, SUMIF formula on Sheet2 referencing the table.
#[test]
fn test_sumif_cross_sheet_structured_ref() {
    let si_data: u32 = 0;
    let si_formula: u32 = 1;

    let data = vec![("Alice", 100.0), ("Bob", 200.0), ("Alice", 300.0)];

    // Sheet1: data sheet with table
    let mut data_cells: Vec<CellData> = Vec::new();
    data_cells.push(CellData {
        cell_id: cell_uuid(si_data, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::Text("Name".into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    data_cells.push(CellData {
        cell_id: cell_uuid(si_data, 0, 1),
        row: 0,
        col: 1,
        value: CellValue::Text("Amount".into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    for (ri, (name, amount)) in data.iter().enumerate() {
        let row = ri as u32 + 1;
        data_cells.push(CellData {
            cell_id: cell_uuid(si_data, row, 0),
            row,
            col: 0,
            value: CellValue::Text(name.to_string().into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        data_cells.push(CellData {
            cell_id: cell_uuid(si_data, row, 1),
            row,
            col: 1,
            value: CellValue::number(*amount),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // Sheet2: formula sheet
    let formula_cells = vec![CellData {
        cell_id: cell_uuid(si_formula, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: Some(r#"SUMIF(Sales[Name],"Alice",Sales[Amount])"#.to_string()),
        identity_formula: None,
        array_ref: None,
    }];

    let table_def = TableDef {
        name: "Sales".to_string(),
        sheet: sheet_id(si_data),
        start_row: 0,
        start_col: 0,
        end_row: 3,
        end_col: 1,
        columns: vec!["Name".to_string(), "Amount".to_string()],
        has_headers: true,
        has_totals: false,
    };

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet_uuid(si_data),
                name: "DataSheet".to_string(),
                rows: 5,
                cols: 3,
                cells: data_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet_uuid(si_formula),
                name: "Summary".to_string(),
                rows: 5,
                cols: 3,
                cells: formula_cells,
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![table_def],
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
    print_result("test_sumif_cross_sheet_structured_ref", &result);

    let val = find_changed_value(&result, si_formula, 0, 0);
    let err = find_error(&result, si_formula, 0, 0);
    println!("Cross-sheet SUMIF: val={:?}, err={:?}", val, err);
    assert!(err.is_none(), "Cross-sheet SUMIF error: {:?}", err);
    assert!(val.is_some(), "Cross-sheet SUMIF not in changed_cells");
    match val.unwrap() {
        CellValue::Number(n) => assert!(
            (n.get() - 400.0).abs() < 1e-10,
            "Cross-sheet SUMIF: expected 400, got {}",
            n.get()
        ),
        CellValue::Error(e, _) => panic!("Cross-sheet SUMIF returned error: {:?}", e),
        other => panic!("Cross-sheet SUMIF: expected Number(400), got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Test 13: SUMIF with non-existent table (error propagation)
// ---------------------------------------------------------------------------

/// When the table doesn't exist, SUMIF should return #REF!, not 0.
/// BUG: Currently SUMIF returns 0 because it doesn't check for error arguments.
#[test]
fn test_sumif_nonexistent_table_returns_error() {
    let si: u32 = 0;
    let cells = vec![
        CellData {
            cell_id: cell_uuid(si, 0, 0),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: Some(r#"SUMIF(NonExistent[Col],"x")"#.to_string()),
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(si, 1, 0),
            row: 1,
            col: 0,
            value: CellValue::Null,
            formula: Some(r#"COUNTIF(NonExistent[Col],"x")"#.to_string()),
            identity_formula: None,
            array_ref: None,
        },
    ];

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(si),
            name: "Sheet1".to_string(),
            rows: 5,
            cols: 3,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![], // No tables defined!
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
    print_result("test_sumif_nonexistent_table_returns_error", &result);

    // SUMIF with non-existent table should return #REF!, not 0
    let val_sumif = find_changed_value(&result, si, 0, 0);
    println!("SUMIF(NonExistent[Col]): val={:?}", val_sumif);
    match val_sumif {
        Some(CellValue::Error(e, None)) => {
            assert_eq!(e, CellError::Ref, "Expected #REF! error");
            println!("PASS: SUMIF correctly propagates #REF! for non-existent table");
        }
        other => panic!("Expected Error(Ref), got {:?}", other),
    }

    // COUNTIF with non-existent table should also return #REF!
    let val_countif = find_changed_value(&result, si, 1, 0);
    println!("COUNTIF(NonExistent[Col]): val={:?}", val_countif);
    match val_countif {
        Some(CellValue::Error(e, None)) => {
            assert_eq!(e, CellError::Ref, "Expected #REF! error");
            println!("PASS: COUNTIF correctly propagates #REF! for non-existent table");
        }
        other => panic!("Expected Error(Ref), got {:?}", other),
    }
}
