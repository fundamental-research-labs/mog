//! Integration tests for COUNTIFS/SUMIFS when criteria ranges contain formula cells.
//!
//! These tests investigate a bug where COUNTIFS returns 1 instead of 9 when
//! the criteria range `$AC:$AC` contains formula cells (`=TRUE`) and the text
//! criteria is `"TRUE"`.
//!
//! Hypotheses tested:
//!   H1: Boolean formula cells + text criteria "TRUE" matching
//!   H2: Agg prepass resolves COUNTIFS before formula cells are evaluated
//!   H3: Cross-sheet COUNTIFS with formula cells in criteria range
//!   H4: Range materialization reads stale pre-recalc values
//!   H5: SUMIFS partial matching (~38% of expected) suggests timing issue
//!   H6: Large group (>8 formulas) triggers agg prepass with formula guard
//!
//! Run:
//!   cd os && cargo test -p compute-core --test countifs_formula_range -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

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

fn assert_num(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: f64) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Cell (sheet={},row={},col={}) expected {}, got {}",
                sheet_idx,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Cell (sheet={},row={},col={}) expected Number({}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell (sheet={},row={},col={}) not in changed_cells (expected Number({})). \
             This may mean the cell was not recalculated or matched the initial value.",
            sheet_idx, row, col, expected
        ),
    }
}

fn assert_bool(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: bool) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Boolean(b)) => {
            assert_eq!(
                b, expected,
                "Cell (sheet={},row={},col={}) expected Boolean({}), got Boolean({})",
                sheet_idx, row, col, expected, b
            );
        }
        Some(other) => panic!(
            "Cell (sheet={},row={},col={}) expected Boolean({}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell (sheet={},row={},col={}) not in changed_cells (expected Boolean({}))",
            sheet_idx, row, col, expected
        ),
    }
}

// ===========================================================================
// H1: Boolean formula cells + text criteria "TRUE" matching
// ===========================================================================

/// Basic test: COUNTIFS with text criteria "TRUE" matching Boolean(true) values
/// from formula cells (=TRUE).
///
/// Single sheet, small range, no agg prepass involved.
#[test]
fn h1_countifs_true_text_matches_boolean_formula_cells() {
    // Col A: formula cells that evaluate to Boolean(true)
    // Col B: category labels
    // Col C: COUNTIFS formula
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // 10 rows: col A has =TRUE formula, col B has alternating "Sales"/"Ops"
    let categories = [
        "Sales", "Ops", "Sales", "Sales", "Ops", "Sales", "Ops", "Sales", "Sales", "Ops",
    ];
    for i in 0..10u32 {
        // Col A: formula =TRUE, initial value Number(1.0) (mimics XLSX import)
        cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
        // Col B: category
        cells.push((i, 1, CellValue::Text(categories[i as usize].into()), None));
    }

    // Col C row 0: COUNTIFS(A:A,"TRUE",B:B,"Sales")
    // Expected: count of rows where A=TRUE AND B="Sales" = 6 (rows 0,2,3,5,7,8)
    cells.push((
        0,
        2,
        CellValue::Null,
        Some(r#"COUNTIFS(A:A,"TRUE",B:B,"Sales")"#),
    ));

    let snapshot = build_snapshot(vec![("Sheet1", 20, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Verify formula cells evaluated to Boolean(true)
    assert_bool(&result, 0, 0, 0, true);
    assert_bool(&result, 0, 5, 0, true);

    // COUNTIFS should count 6 rows where A=TRUE AND B="Sales"
    assert_num(&result, 0, 0, 2, 6.0);
}

/// COUNTIF with just "TRUE" criteria (single criteria, simpler path).
#[test]
fn h1_countif_true_text_matches_boolean_formula_single() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // 5 rows: 3 have =TRUE formula, 2 have =FALSE formula
    for i in 0..3u32 {
        cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
    }
    for i in 3..5u32 {
        cells.push((i, 0, CellValue::number(0.0), Some("FALSE")));
    }

    // COUNTIF(A:A,"TRUE") = 3
    cells.push((6, 1, CellValue::Null, Some(r#"COUNTIF(A:A,"TRUE")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 10, 3, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_num(&result, 0, 6, 1, 3.0);
}

/// SUMIFS with "TRUE" criteria and formula cells.
#[test]
fn h1_sumifs_true_text_with_formula_criteria_range() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: formula cells =TRUE (initial Number(1.0))
    // Col B: values to sum
    for i in 0..5u32 {
        cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
        cells.push((i, 1, CellValue::number((i + 1) as f64 * 100.0), None));
    }

    // SUMIFS(B:B,A:A,"TRUE") = 100+200+300+400+500 = 1500
    cells.push((6, 2, CellValue::Null, Some(r#"SUMIFS(B:B,A:A,"TRUE")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_num(&result, 0, 6, 2, 1500.0);
}

// ===========================================================================
// H2: Agg prepass with formula cells in criteria range (>=8 formula group)
// ===========================================================================

/// When 8+ consecutive COUNTIFS cells share the same pattern, the agg prepass
/// is triggered. If the criteria range contains formula cells, the prepass
/// guard should bail and fall back to normal topo evaluation.
#[test]
fn h2_agg_prepass_bails_when_criteria_has_formula_cells() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // 20 data rows: col A = formula =TRUE, col B = alternating categories
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];
    for i in 0..20u32 {
        cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
        let cat = categories[(i as usize) % categories.len()];
        cells.push((i, 1, CellValue::Text(cat.into()), None));
    }

    // 10 COUNTIFS formulas (exceeds AGG_MIN_GROUP_SIZE=8) in col C
    // Each counts rows where A="TRUE" AND B=<dynamic>
    // Col D has the criteria values
    for i in 0..10u32 {
        let row = 30 + i; // place formulas below data
        let cat = categories[(i as usize) % categories.len()];
        cells.push((row, 3, CellValue::Text(cat.into()), None)); // col D: criteria
        let formula = format!(r#"COUNTIFS(A:A,"TRUE",B:B,D{})"#, row + 1);
        cells.push((
            row,
            2,
            CellValue::Null,
            Some(Box::leak(formula.into_boxed_str())),
        ));
    }

    let snapshot = build_snapshot(vec![("Sheet1", 50, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Alpha occurs at rows 0,4,8,12,16 = 5 times
    // Beta occurs at rows 1,5,9,13,17 = 5 times
    // Gamma occurs at rows 2,6,10,14,18 = 5 times
    // Delta occurs at rows 3,7,11,15,19 = 5 times
    // All have A=TRUE after recalc, so COUNTIFS should return 5 for each
    assert_num(&result, 0, 30, 2, 5.0); // Alpha
    assert_num(&result, 0, 31, 2, 5.0); // Beta
    assert_num(&result, 0, 32, 2, 5.0); // Gamma
    assert_num(&result, 0, 33, 2, 5.0); // Delta
    // Repeat pattern
    assert_num(&result, 0, 34, 2, 5.0); // Alpha
    assert_num(&result, 0, 35, 2, 5.0); // Beta
}

/// Same as above but with SUMIFS to test the sum path.
#[test]
fn h2_agg_prepass_sumifs_with_formula_criteria_range() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // 20 data rows: col A = formula =TRUE, col B = values, col C = categories
    let categories = ["Alpha", "Beta"];
    for i in 0..20u32 {
        cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
        cells.push((i, 1, CellValue::number((i + 1) as f64), None)); // 1,2,3,...,20
        let cat = categories[(i as usize) % categories.len()];
        cells.push((i, 2, CellValue::Text(cat.into()), None));
    }

    // 10 SUMIFS formulas in col D (exceeds AGG_MIN_GROUP_SIZE=8)
    for i in 0..10u32 {
        let row = 25 + i;
        let cat = categories[(i as usize) % categories.len()];
        cells.push((row, 4, CellValue::Text(cat.into()), None)); // col E: criteria
        let formula = format!(r#"SUMIFS(B:B,A:A,"TRUE",C:C,E{})"#, row + 1);
        cells.push((
            row,
            3,
            CellValue::Null,
            Some(Box::leak(formula.into_boxed_str())),
        ));
    }

    let snapshot = build_snapshot(vec![("Sheet1", 50, 6, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Alpha rows: 0,2,4,6,8,10,12,14,16,18 → values: 1,3,5,7,9,11,13,15,17,19 → sum=100
    // Beta rows:  1,3,5,7,9,11,13,15,17,19 → values: 2,4,6,8,10,12,14,16,18,20 → sum=110
    assert_num(&result, 0, 25, 3, 100.0); // Alpha
    assert_num(&result, 0, 26, 3, 110.0); // Beta
    assert_num(&result, 0, 27, 3, 100.0); // Alpha
    assert_num(&result, 0, 28, 3, 110.0); // Beta
}

// ===========================================================================
// H3: Cross-sheet COUNTIFS with formula cells in criteria range
// ===========================================================================

/// The exact pattern from the bug: COUNTIFS on one sheet, formula cells on
/// another sheet, using full-column references.
#[test]
fn h3_cross_sheet_countifs_formula_criteria_range() {
    let mut data_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Data sheet: col A (0) = formula =TRUE, col B (1) = department
    let departments = [
        "Sales",
        "Engineering",
        "Sales",
        "Marketing",
        "Sales",
        "Engineering",
        "Sales",
        "Sales",
        "Marketing",
        "Sales",
    ];
    for i in 0..10u32 {
        data_cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
        data_cells.push((i, 1, CellValue::Text(departments[i as usize].into()), None));
    }

    // Summary sheet: COUNTIFS referencing data sheet with full-column refs
    let mut summary_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    summary_cells.push((0, 0, CellValue::Text("Sales".into()), None));
    summary_cells.push((1, 0, CellValue::Text("Engineering".into()), None));
    summary_cells.push((2, 0, CellValue::Text("Marketing".into()), None));

    // COUNTIFS('Data'!A:A,"TRUE",'Data'!B:B,A1)
    summary_cells.push((
        0,
        1,
        CellValue::Null,
        Some(r#"COUNTIFS(Data!A:A,"TRUE",Data!B:B,A1)"#),
    ));
    summary_cells.push((
        1,
        1,
        CellValue::Null,
        Some(r#"COUNTIFS(Data!A:A,"TRUE",Data!B:B,A2)"#),
    ));
    summary_cells.push((
        2,
        1,
        CellValue::Null,
        Some(r#"COUNTIFS(Data!A:A,"TRUE",Data!B:B,A3)"#),
    ));

    let snapshot = build_snapshot(vec![
        ("Summary", 10, 5, summary_cells),
        ("Data", 20, 5, data_cells),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Sales rows (with A=TRUE after recalc): 0,2,4,6,7,9 = 6
    // Engineering rows: 1,5 = 2
    // Marketing rows: 3,8 = 2
    assert_num(&result, 0, 0, 1, 6.0);
    assert_num(&result, 0, 1, 1, 2.0);
    assert_num(&result, 0, 2, 1, 2.0);
}

/// Cross-sheet SUMIFS with formula cells in BOTH criteria and value ranges.
#[test]
fn h3_cross_sheet_sumifs_formula_in_criteria_and_value() {
    let mut data_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: formula =TRUE (criteria range with formulas)
    // Col B: formula =ROW()*100 (value range with formulas)
    // Col C: department (static)
    let departments = ["Sales", "Ops", "Sales", "Ops", "Sales"];
    for i in 0..5u32 {
        data_cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
        let val_formula = format!("{}*100", i + 1);
        data_cells.push((
            i,
            1,
            CellValue::Null,
            Some(Box::leak(val_formula.into_boxed_str())),
        ));
        data_cells.push((i, 2, CellValue::Text(departments[i as usize].into()), None));
    }

    let mut summary_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    summary_cells.push((0, 0, CellValue::Text("Sales".into()), None));
    // SUMIFS(Data!B:B,Data!A:A,"TRUE",Data!C:C,A1)
    summary_cells.push((
        0,
        1,
        CellValue::Null,
        Some(r#"SUMIFS(Data!B:B,Data!A:A,"TRUE",Data!C:C,A1)"#),
    ));

    let snapshot = build_snapshot(vec![
        ("Summary", 5, 5, summary_cells),
        ("Data", 10, 5, data_cells),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Sales rows: 0,2,4 → values: 1*100=100, 3*100=300, 5*100=500 → sum=900
    assert_num(&result, 0, 0, 1, 900.0);
}

// ===========================================================================
// H4: Range materialization timing (formula cells at different topo levels)
// ===========================================================================

/// Formula cells in criteria range depend on OTHER formula cells, creating
/// a multi-level dependency chain. COUNTIFS should only evaluate after the
/// entire chain is resolved.
#[test]
fn h4_countifs_criteria_range_with_dependency_chain() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: base values
    // Col B: formula =IF(A>0,TRUE,FALSE) — depends on col A
    // Col C: COUNTIFS formula
    for i in 0..5u32 {
        cells.push((
            i,
            0,
            CellValue::number(if i < 3 { (i + 1) as f64 } else { 0.0 }),
            None,
        ));
        cells.push((i, 1, CellValue::Null, Some("IF(A1>0,TRUE,FALSE)"))); // relative ref
    }
    // Fix: the formulas need absolute positioning. Use row-specific formulas.
    // Actually, let me use correct relative refs. Row i, col B: =IF(A{i+1}>0,TRUE,FALSE)
    // But the test framework uses the formula as-is with the cell's position for relative resolution.
    // Since each cell is at (i, 1), "IF(A1>0,TRUE,FALSE)" is relative — it refers to the cell
    // at the same row in col A. Wait, that depends on how the parser resolves it.
    // Let me use explicit row references to be safe.

    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    for i in 0..5u32 {
        let val = if i < 3 { (i + 1) as f64 } else { 0.0 };
        cells.push((i, 0, CellValue::number(val), None));
    }
    // Col B formulas with explicit row refs
    cells.push((0, 1, CellValue::Null, Some("IF(A1>0,TRUE,FALSE)")));
    cells.push((1, 1, CellValue::Null, Some("IF(A2>0,TRUE,FALSE)")));
    cells.push((2, 1, CellValue::Null, Some("IF(A3>0,TRUE,FALSE)")));
    cells.push((3, 1, CellValue::Null, Some("IF(A4>0,TRUE,FALSE)")));
    cells.push((4, 1, CellValue::Null, Some("IF(A5>0,TRUE,FALSE)")));

    // COUNTIF(B:B,"TRUE") should = 3 (rows 0,1,2 have A>0)
    cells.push((6, 2, CellValue::Null, Some(r#"COUNTIF(B:B,"TRUE")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_num(&result, 0, 6, 2, 3.0);
}

/// SUMIFS where the value range contains formulas that depend on other cells.
/// Tests that range_store pre-materialization captures post-recalc values.
#[test]
fn h4_sumifs_value_range_with_formula_chain() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: base numbers
    // Col B: formula = A*2 (depends on col A)
    // Col C: categories
    let data = [
        (10.0, "X"),
        (20.0, "Y"),
        (30.0, "X"),
        (40.0, "Y"),
        (50.0, "X"),
    ];
    for (i, (val, cat)) in data.iter().enumerate() {
        let row = i as u32;
        cells.push((row, 0, CellValue::number(*val), None));
        let formula = format!("A{}*2", row + 1);
        cells.push((
            row,
            1,
            CellValue::Null,
            Some(Box::leak(formula.into_boxed_str())),
        ));
        cells.push((row, 2, CellValue::Text((*cat).into()), None));
    }

    // SUMIFS(B:B,C:C,"X") = (10*2)+(30*2)+(50*2) = 20+60+100 = 180
    cells.push((6, 3, CellValue::Null, Some(r#"SUMIFS(B:B,C:C,"X")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_num(&result, 0, 6, 3, 180.0);
}

// ===========================================================================
// H5: Large-scale cross-sheet to test ~38% matching hypothesis
// ===========================================================================

/// Reproduces the exact pattern from the bug: large dataset with formula cells
/// in criteria range, cross-sheet COUNTIFS with >=8 formulas (agg prepass eligible).
#[test]
fn h5_cross_sheet_large_countifs_formula_criteria() {
    let n_data = 100u32;
    let n_formulas = 20u32; // >8 to trigger agg prepass detection

    let mut data_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Data sheet: col A = formula =TRUE, col B = department
    let departments = ["Sales", "Engineering", "Marketing", "HR"];
    for i in 0..n_data {
        data_cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
        let dept = departments[(i as usize) % departments.len()];
        data_cells.push((i, 1, CellValue::Text(dept.into()), None));
        // Col C: numeric value for SUMIFS
        data_cells.push((i, 2, CellValue::number((i + 1) as f64), None));
    }

    // Summary sheet with 20 COUNTIFS formulas
    let mut summary_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    for i in 0..n_formulas {
        let row = i;
        let dept = departments[(i as usize) % departments.len()];
        summary_cells.push((row, 0, CellValue::Text(dept.into()), None)); // col A: criteria

        let countifs_formula = format!(r#"COUNTIFS(Data!A:A,"TRUE",Data!B:B,A{})"#, row + 1);
        summary_cells.push((
            row,
            1,
            CellValue::Null,
            Some(Box::leak(countifs_formula.into_boxed_str())),
        ));

        let sumifs_formula = format!(r#"SUMIFS(Data!C:C,Data!A:A,"TRUE",Data!B:B,A{})"#, row + 1);
        summary_cells.push((
            row,
            2,
            CellValue::Null,
            Some(Box::leak(sumifs_formula.into_boxed_str())),
        ));
    }

    let snapshot = build_snapshot(vec![
        ("Summary", 30, 5, summary_cells),
        ("Data", n_data + 10, 5, data_cells),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Each department has 25 rows (100/4)
    // Sales: rows 0,4,8,...,96 = 25 rows
    // Engineering: rows 1,5,9,...,97 = 25 rows
    // Marketing: rows 2,6,10,...,98 = 25 rows
    // HR: rows 3,7,11,...,99 = 25 rows

    // COUNTIFS for Sales = 25
    assert_num(&result, 0, 0, 1, 25.0);
    // COUNTIFS for Engineering = 25
    assert_num(&result, 0, 1, 1, 25.0);
    // COUNTIFS for Marketing = 25
    assert_num(&result, 0, 2, 1, 25.0);
    // COUNTIFS for HR = 25
    assert_num(&result, 0, 3, 1, 25.0);

    // SUMIFS for Sales: sum of (1,5,9,...,97) = sum of (4k+1) for k=0..24
    // = 25*1 + 4*(0+1+...+24) = 25 + 4*300 = 25 + 1200 = 1225
    assert_num(&result, 0, 0, 2, 1225.0);
    // SUMIFS for Engineering: sum of (2,6,10,...,98) = sum of (4k+2) for k=0..24
    // = 25*2 + 4*300 = 50 + 1200 = 1250
    assert_num(&result, 0, 1, 2, 1250.0);
}

// ===========================================================================
// H6: COUNTIFS with Boolean(true) criteria (not text "TRUE")
// ===========================================================================

/// Test the case where the criteria VALUE is Boolean(true) (from a cell ref),
/// not the text string "TRUE".
#[test]
fn h6_countifs_boolean_criteria_from_cell_ref() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: mix of TRUE/FALSE values (static booleans)
    cells.push((0, 0, CellValue::Boolean(true), None));
    cells.push((1, 0, CellValue::Boolean(false), None));
    cells.push((2, 0, CellValue::Boolean(true), None));
    cells.push((3, 0, CellValue::Boolean(true), None));
    cells.push((4, 0, CellValue::Boolean(false), None));

    // Col B: categories
    cells.push((0, 1, CellValue::Text("X".into()), None));
    cells.push((1, 1, CellValue::Text("X".into()), None));
    cells.push((2, 1, CellValue::Text("Y".into()), None));
    cells.push((3, 1, CellValue::Text("X".into()), None));
    cells.push((4, 1, CellValue::Text("X".into()), None));

    // Criteria cell: Boolean TRUE
    cells.push((7, 0, CellValue::Boolean(true), None));

    // COUNTIFS(A:A,A8,B:B,"X") — criteria is a cell ref to Boolean(true)
    cells.push((7, 2, CellValue::Null, Some(r#"COUNTIFS(A:A,A8,B:B,"X")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Rows where A=TRUE AND B="X": rows 0, 3 = 2
    assert_num(&result, 0, 7, 2, 2.0);
}

/// Test COUNTIFS where criteria range has XLOOKUP formula cells.
/// This mimics the _2025 Census bug where AE column has XLOOKUP formulas.
#[test]
fn h6_countifs_criteria_range_with_xlookup_formulas() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: employee IDs
    // Col B: department lookup table (ID -> dept)
    // Col C: XLOOKUP formula that looks up department from col A in a table
    // Col D: COUNTIFS formula

    // Lookup table in cols D-E (rows 0-3)
    let lookup = [
        ("E001", "Sales"),
        ("E002", "Engineering"),
        ("E003", "Sales"),
        ("E004", "Marketing"),
    ];
    for (i, (id, dept)) in lookup.iter().enumerate() {
        let row = i as u32;
        cells.push((row, 3, CellValue::Text((*id).into()), None));
        cells.push((row, 4, CellValue::Text((*dept).into()), None));
    }

    // Employee data in col A, XLOOKUP result in col B
    let employee_ids = ["E001", "E003", "E002", "E001", "E004", "E003"];
    for (i, id) in employee_ids.iter().enumerate() {
        let row = i as u32;
        cells.push((row, 0, CellValue::Text((*id).into()), None));
        // XLOOKUP(A{row+1},D:D,E:E)
        let formula = format!("XLOOKUP(A{},D:D,E:E)", row + 1);
        cells.push((
            row,
            1,
            CellValue::Null,
            Some(Box::leak(formula.into_boxed_str())),
        ));
    }

    // COUNTIF(B:B,"Sales") — counts XLOOKUP results that are "Sales"
    cells.push((8, 2, CellValue::Null, Some(r#"COUNTIF(B:B,"Sales")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 15, 6, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Employees: E001→Sales, E003→Sales, E002→Engineering, E001→Sales, E004→Marketing, E003→Sales
    // Sales count = 4
    assert_num(&result, 0, 8, 2, 4.0);
}

// ===========================================================================
// H7: Number(1.0) vs Boolean(true) — pre-recalc value mismatch
// ===========================================================================

/// Directly tests that Number(1.0) does NOT match "TRUE" criteria,
/// while Boolean(true) DOES match. This confirms that if COUNTIFS reads
/// stale pre-recalc values (Number(1.0)), it would undercount.
#[test]
fn h7_number_one_does_not_match_true_criteria() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: mix of Number(1.0) and Boolean(true)
    cells.push((0, 0, CellValue::number(1.0), None)); // Number - should NOT match "TRUE"
    cells.push((1, 0, CellValue::Boolean(true), None)); // Boolean - SHOULD match "TRUE"
    cells.push((2, 0, CellValue::number(1.0), None)); // Number - should NOT match
    cells.push((3, 0, CellValue::Boolean(true), None)); // Boolean - SHOULD match
    cells.push((4, 0, CellValue::Text("TRUE".into()), None)); // Text - SHOULD match

    // COUNTIF(A:A,"TRUE") should be 3 (two booleans + one text)
    cells.push((6, 1, CellValue::Null, Some(r#"COUNTIF(A:A,"TRUE")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 10, 3, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    assert_num(&result, 0, 6, 1, 3.0);
}

/// Key test: formula cells start with Number(1.0) as the initial/cached value.
/// After recalc, they should be Boolean(true) and match "TRUE" criteria.
/// If COUNTIFS reads the pre-recalc Number(1.0), it would return 0 instead of N.
#[test]
fn h7_formula_true_starts_as_number_one_evaluates_to_boolean() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Col A: 5 formula cells =TRUE with initial value Number(1.0)
    // This simulates XLSX import where cached value "1" → Number(1.0)
    for i in 0..5u32 {
        cells.push((i, 0, CellValue::number(1.0), Some("TRUE")));
    }

    // COUNTIF(A1:A5,"TRUE") — should be 5 after recalc (all become Boolean(true))
    // Would be 0 if reading pre-recalc Number(1.0) values
    cells.push((6, 1, CellValue::Null, Some(r#"COUNTIF(A1:A5,"TRUE")"#)));

    // Also test with full-column ref
    cells.push((7, 1, CellValue::Null, Some(r#"COUNTIF(A:A,"TRUE")"#)));

    let snapshot = build_snapshot(vec![("Sheet1", 10, 3, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // All 5 formula cells should now be Boolean(true)
    assert_bool(&result, 0, 0, 0, true);
    assert_bool(&result, 0, 4, 0, true);

    // COUNTIF with explicit range should match all 5
    assert_num(&result, 0, 6, 1, 5.0);

    // COUNTIF with full-column ref should also match all 5
    assert_num(&result, 0, 7, 1, 5.0);
}

// ===========================================================================
// H8: Static "TRUE" criteria in agg prepass (StaticFilter path)
// ===========================================================================

/// Test that the agg prepass correctly handles StaticFilter criteria "TRUE"
/// when the criteria range has NO formula cells (should use prepass).
/// This is the baseline — the prepass should work for static data.
#[test]
fn h8_agg_prepass_static_true_criteria_no_formula_range() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // 20 data rows: col A = static Boolean(true), col B = categories
    let categories = ["Sales", "Ops"];
    for i in 0..20u32 {
        cells.push((i, 0, CellValue::Boolean(true), None)); // static, not formula
        let cat = categories[(i as usize) % categories.len()];
        cells.push((i, 1, CellValue::Text(cat.into()), None));
    }

    // 10 COUNTIFS formulas (exceeds AGG_MIN_GROUP_SIZE=8)
    for i in 0..10u32 {
        let row = 25 + i;
        let cat = categories[(i as usize) % categories.len()];
        cells.push((row, 3, CellValue::Text(cat.into()), None)); // criteria
        let formula = format!(r#"COUNTIFS(A:A,"TRUE",B:B,D{})"#, row + 1);
        cells.push((
            row,
            2,
            CellValue::Null,
            Some(Box::leak(formula.into_boxed_str())),
        ));
    }

    let snapshot = build_snapshot(vec![("Sheet1", 50, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Sales = 10 (every even row), Ops = 10 (every odd row)
    assert_num(&result, 0, 25, 2, 10.0); // Sales
    assert_num(&result, 0, 26, 2, 10.0); // Ops
    assert_num(&result, 0, 27, 2, 10.0); // Sales
}
