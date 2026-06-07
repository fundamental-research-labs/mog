#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use formula_types::{NamedRangeDef, Scope};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Test 01: 100 formula replacements on same cell
// B1=10. Loop i in 0..100: set A1="=B1+{i}", assert A1=10+i.
// After all: A1=10+99=109.
// ---------------------------------------------------------------------------
#[test]
fn test_100_formula_replacements_same_cell() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 1, CellValue::number(10.0), None), // B1=10
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    for i in 0u32..100 {
        let formula = format!("=B1+{}", i);
        let _r = set(&mut core, &mut mirror, 0, 0, 0, &formula);
        assert_mirror_number(&mirror, 0, 0, 0, 10.0 + i as f64);
    }

    // Final state: A1 = 10 + 99 = 109
    assert_mirror_number(&mirror, 0, 0, 0, 109.0);
}

// ---------------------------------------------------------------------------
// Test 02: Alternating formula/value/formula/clear
// B1=10, C1=20. Loop 50 iterations:
//   set A1="=B1+1" → 11
//   set A1="42" → 42
//   set A1="=C1+1" → 21
//   clear A1 → Null
// ---------------------------------------------------------------------------
#[test]
fn test_alternating_formula_value_clear() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 1, CellValue::number(10.0), None), // B1=10
            (0, 2, CellValue::number(20.0), None), // C1=20
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    for _ in 0..50 {
        // A1="=B1+1" → 11
        let _r = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
        assert_mirror_number(&mirror, 0, 0, 0, 11.0);

        // A1="42" → 42
        let _r = set(&mut core, &mut mirror, 0, 0, 0, "42");
        assert_mirror_number(&mirror, 0, 0, 0, 42.0);

        // A1="=C1+1" → 21
        let _r = set(&mut core, &mut mirror, 0, 0, 0, "=C1+1");
        assert_mirror_number(&mirror, 0, 0, 0, 21.0);

        // Clear A1 → Null
        let _r = core.clear_cells(&mut mirror, &[cid(0, 0, 0)]).unwrap();
        assert_mirror_null(&mirror, 0, 0, 0);
    }
}

// ---------------------------------------------------------------------------
// Test 03: Parse error precedent edge cycling
// B1=10. Loop 20: set A1="=@@@" → error, set A1="=B1+1" → 11.
// ---------------------------------------------------------------------------
#[test]
fn test_parse_error_precedent_cycling() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 1, CellValue::number(10.0), None), // B1=10
        ],
    )]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    for _ in 0..20 {
        // Parse error formula
        let _r = set(&mut core, &mut mirror, 0, 0, 0, "=@@@");
        assert_mirror_is_any_error(&mirror, 0, 0, 0);

        // Valid formula
        let _r = set(&mut core, &mut mirror, 0, 0, 0, "=B1+1");
        assert_mirror_number(&mirror, 0, 0, 0, 11.0);
    }
}

// ---------------------------------------------------------------------------
// Test 04: Batch create/break cycle
// Loop 10: set_cells([(A1,"=B1+1"),(B1,"=A1+1")], skip=true) → cycle
// Then set_cells([(A1,"1"),(B1,"2")], skip=false) → break cycle
// ---------------------------------------------------------------------------
#[test]
fn test_batch_create_break_cycle_repeatedly() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![("Sheet1", 100, 26, vec![])]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    let s = sid(0);

    for _ in 0..10 {
        // Create cycle with skip_cycle_check=true.
        let edits_cycle: Vec<(
            SheetId,
            CellId,
            u32,
            u32,
            compute_core::bridge_types::CellInput,
        )> = vec![
            (
                s,
                cid(0, 0, 0),
                0,
                0,
                compute_core::bridge_types::CellInput::Parse {
                    text: "=B1+1".to_string(),
                },
            ),
            (
                s,
                cid(0, 0, 1),
                0,
                1,
                compute_core::bridge_types::CellInput::Parse {
                    text: "=A1+1".to_string(),
                },
            ),
        ];
        let r = core.set_cells(&mut mirror, &edits_cycle, true).unwrap();
        assert!(r.metrics.has_circular_refs, "Should detect circular refs");

        // Break cycle with plain values
        let edits_break: Vec<(
            SheetId,
            CellId,
            u32,
            u32,
            compute_core::bridge_types::CellInput,
        )> = vec![
            (
                s,
                cid(0, 0, 0),
                0,
                0,
                compute_core::bridge_types::CellInput::Parse {
                    text: "1".to_string(),
                },
            ),
            (
                s,
                cid(0, 0, 1),
                0,
                1,
                compute_core::bridge_types::CellInput::Parse {
                    text: "2".to_string(),
                },
            ),
        ];
        let _r = core.set_cells(&mut mirror, &edits_break, false).unwrap();
        assert_mirror_number(&mirror, 0, 0, 0, 1.0);
        assert_mirror_number(&mirror, 0, 0, 1, 2.0);
    }
}

// ---------------------------------------------------------------------------
// Test 05: Fan-out — 100 cells depend on A1, then clear A1
// A1=100. B1..B100 all "=A1*{i}" for i=1..100.
// Assert B_i = 100*i. Clear A1 → B_i = 0*i = 0. Set A1=200 → B_i=200*i.
// ---------------------------------------------------------------------------
#[test]
fn test_fan_out_100_dependents() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();

    // Build snapshot with A1=100 and B1..B100 = "=A1*i"
    let mut cell_data: Vec<CellData> = Vec::new();
    // A1 (row=0, col=0) = 100
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 0),
        row: 0,
        col: 0,
        value: CellValue::number(100.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });
    // B1..B100 → row 0..99, col 1, formula "=A1*i"
    for i in 1u32..=100 {
        cell_data.push(CellData {
            cell_id: cell_uuid(0, i - 1, 1),
            row: i - 1,
            col: 1,
            value: CellValue::number(0.0),
            formula: Some(format!("A1*{}", i)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: 200,
            cols: 26,
            cells: cell_data,
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
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Assert B_i = 100*i for i=1..100
    for i in 1u32..=100 {
        assert_mirror_number(&mirror, 0, i - 1, 1, 100.0 * i as f64);
    }

    // Clear A1 → Null coerces to 0, so B_i = 0*i = 0
    let _r = core.clear_cells(&mut mirror, &[cid(0, 0, 0)]).unwrap();
    assert_mirror_number(&mirror, 0, 0, 1, 0.0); // B1
    assert_mirror_number(&mirror, 0, 49, 1, 0.0); // B50
    assert_mirror_number(&mirror, 0, 99, 1, 0.0); // B100

    // Set A1=200 → B_i = 200*i
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "200");
    for i in 1u32..=100 {
        assert_mirror_number(&mirror, 0, i - 1, 1, 200.0 * i as f64);
    }
}

// ---------------------------------------------------------------------------
// Test 06: Fan-in — 25 cells feed into one SUM
// A1..Y1 = 1..25. Z1="=SUM(A1:Y1)"=325.
// Edit A1=100 → Z1=325-1+100=424. Edit B1=200 → Z1=424-2+200=622.
// ---------------------------------------------------------------------------
#[test]
fn test_fan_in_25_cells_to_sum() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();

    // A1=1 (col=0) .. Y1=25 (col=24), Z1=SUM(A1:Y1) (col=25)
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    for col in 0u32..25 {
        cells.push((0, col, CellValue::number((col + 1) as f64), None));
    }
    cells.push((0, 25, CellValue::number(0.0), Some("SUM(A1:Y1)")));

    let snapshot = build_snapshot(vec![("Sheet1", 100, 27, cells)]);
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Z1 = SUM(1..25) = 325
    assert_mirror_number(&mirror, 0, 0, 25, 325.0);

    // Edit A1=100: Z1 = 325 - 1 + 100 = 424
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "100");
    assert_mirror_number(&mirror, 0, 0, 25, 424.0);

    // Edit B1=200: Z1 = 424 - 2 + 200 = 622
    let _r = set(&mut core, &mut mirror, 0, 0, 1, "200");
    assert_mirror_number(&mirror, 0, 0, 25, 622.0);
}

// ---------------------------------------------------------------------------
// Test 07: Diamond dependency with cycle
// A1=10(value). B1="=A1+1"=11, C1="=A1+2"=12.
// D1="=B1+C1+E1", E1="=D1*0.5", iterative.
// FP: D1=11+12+E1=23+E1, E1=D1/2 → D1=46, E1=23.
// set A1=20: B1=21, C1=22. D1=43+E1, E1=D1/2 → D1=86, E1=43.
// ---------------------------------------------------------------------------
#[test]
fn test_diamond_dependency_with_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(10.0), None),            // A1=10
                (0, 1, CellValue::number(0.0), Some("A1+1")),     // B1="=A1+1"
                (0, 2, CellValue::number(0.0), Some("A1+2")),     // C1="=A1+2"
                (0, 3, CellValue::number(0.0), Some("B1+C1+E1")), // D1
                (0, 4, CellValue::number(0.0), Some("D1*0.5")),   // E1
            ],
        )],
        200,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(result.metrics.has_circular_refs);

    // A1=10, B1=11, C1=12
    assert_mirror_number(&mirror, 0, 0, 0, 10.0);
    assert_mirror_number(&mirror, 0, 0, 1, 11.0);
    assert_mirror_number(&mirror, 0, 0, 2, 12.0);

    // D1=46, E1=23
    assert_mirror_number_tol(&mirror, 0, 0, 3, 46.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 4, 23.0, 0.01);

    // set A1=20: B1=21, C1=22, D1=86, E1=43
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "20");
    assert_mirror_number(&mirror, 0, 0, 1, 21.0);
    assert_mirror_number(&mirror, 0, 0, 2, 22.0);
    assert_mirror_number_tol(&mirror, 0, 0, 3, 86.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 4, 43.0, 0.01);
}

// ---------------------------------------------------------------------------
// Test 08: Named range formula
// NR → B1. A1="=NR+C1", C1="=A1*0.5", B1=10, iterative.
// A1=10+C1, C1=A1/2 → A1=10+A1/2 → A1=20, C1=10.
// ---------------------------------------------------------------------------
#[test]
fn test_named_range_in_convergent_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let mut snapshot = build_iterative_snapshot(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(0.0), Some("NR+C1")),  // A1
                (0, 1, CellValue::number(10.0), None),          // B1=10
                (0, 2, CellValue::number(0.0), Some("A1*0.5")), // C1
            ],
        )],
        200,
        0.001,
    );
    // Define NR → Sheet1!B1
    snapshot.named_ranges.push(NamedRangeDef::from_positions(
        "NR".into(),
        Scope::Workbook,
        cid(0, 0, 1), // B1
        cid(0, 0, 1), // B1 (single cell)
        0,
        1,
        0,
        1,
    ));
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(result.metrics.has_circular_refs);

    // A1=20, C1=10
    assert_mirror_number_tol(&mirror, 0, 0, 0, 20.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 10.0, 0.01);
    assert_mirror_number(&mirror, 0, 0, 1, 10.0); // B1 unchanged
}

// ---------------------------------------------------------------------------
// Test 09: Delete sheet feeding cycle
// Sheet1!A1=100. Sheet2!B1="=Sheet1!A1+Sheet2!C1", Sheet2!C1="=Sheet2!B1*0.5"
// Iterative FP: B1=100+C1, C1=B1/2 → B1=200, C1=100.
// remove_sheet(Sheet1) → Sheet2!B1 ref → #REF!
// ---------------------------------------------------------------------------
#[test]
fn test_delete_sheet_feeding_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![
            (
                "Sheet1",
                100,
                26,
                vec![
                    (0, 0, CellValue::number(100.0), None), // Sheet1!A1=100
                ],
            ),
            (
                "Sheet2",
                100,
                26,
                vec![
                    (0, 1, CellValue::number(0.0), Some("Sheet1!A1+Sheet2!C1")), // B1
                    (0, 2, CellValue::number(0.0), Some("Sheet2!B1*0.5")),       // C1
                ],
            ),
        ],
        200,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(result.metrics.has_circular_refs);

    // FP: B1=200, C1=100
    assert_mirror_number_tol(&mirror, 1, 0, 1, 200.0, 0.01);
    assert_mirror_number_tol(&mirror, 1, 0, 2, 100.0, 0.01);

    // Delete Sheet1
    let sheet1_id = sid(0);
    let _r = core.remove_sheet(&mut mirror, &sheet1_id).unwrap();

    // Sheet2!B1 should be #REF! (reference to deleted sheet)
    assert_mirror_error(&mirror, 1, 0, 1, CellError::Ref);
}

// ---------------------------------------------------------------------------
// Test 10: Rename sheet
// Sheet2!B1=100. Sheet1: A1="=Sheet2!B1+C1", C1="=A1*0.5", iterative.
// FP: A1=100+C1, C1=A1/2 → A1=200, C1=100.
// rename_sheet(Sheet2, "Data"). Assert A1≈200, C1≈100.
// set Data!B1=200 → new FP: A1=200+C1, C1=A1/2 → A1=400, C1=200.
// ---------------------------------------------------------------------------
#[test]
fn test_rename_sheet_preserves_cycle() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_iterative_snapshot(
        vec![
            (
                "Sheet1",
                100,
                26,
                vec![
                    (0, 0, CellValue::number(0.0), Some("Sheet2!B1+C1")), // A1
                    (0, 2, CellValue::number(0.0), Some("A1*0.5")),       // C1
                ],
            ),
            (
                "Sheet2",
                100,
                26,
                vec![
                    (0, 1, CellValue::number(100.0), None), // Sheet2!B1=100
                ],
            ),
        ],
        200,
        0.001,
    );
    let result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    assert!(result.metrics.has_circular_refs);

    // FP: A1≈200, C1≈100
    assert_mirror_number_tol(&mirror, 0, 0, 0, 200.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 100.0, 0.01);

    // Rename Sheet2 → "Data"
    let sheet2_id = sid(1);
    core.rename_sheet(&mut mirror, &sheet2_id, "Data");

    // Values should be preserved (formulas use SheetIds internally)
    assert_mirror_number_tol(&mirror, 0, 0, 0, 200.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 100.0, 0.01);

    // set "Data"!B1 = 200 (same sheet ID as old Sheet2, si=1)
    let _r = set(&mut core, &mut mirror, 1, 0, 1, "200");

    // New FP: A1=200+C1, C1=A1/2 → A1=400, C1=200
    assert_mirror_number_tol(&mirror, 0, 0, 0, 400.0, 0.01);
    assert_mirror_number_tol(&mirror, 0, 0, 2, 200.0, 0.01);
}

// ---------------------------------------------------------------------------
// Test 11: CRITICAL — Agg prepass PostOp (Finding A3 regression)
// A1:A100 = 1..100.
// B1="=SUMIFS(A1:A100,A1:A100,\">50\")" = sum(51..100) = 3775
// B2="=SUMIFS(A1:A100,A1:A100,\">50\")/2" = 1887.5
// B3="=SUMIFS(A1:A100,A1:A100,\">50\")+10" = 3785
// set A75=1000 → new sum = 3775-75+1000 = 4700
// B1=4700, B2=2350, B3=4710
// ---------------------------------------------------------------------------
#[test]
fn test_agg_prepass_postop_boundary() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();

    let mut cell_data: Vec<CellData> = Vec::new();
    // A1:A100 = 1..100 (row 0..99, col 0)
    for row in 0u32..100 {
        cell_data.push(CellData {
            cell_id: cell_uuid(0, row, 0),
            row,
            col: 0,
            value: CellValue::number((row + 1) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }
    // B1 (row=0, col=1): SUMIFS(A1:A100,A1:A100,">50")
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 0, 1),
        row: 0,
        col: 1,
        value: CellValue::number(0.0),
        formula: Some("SUMIFS(A1:A100,A1:A100,\">50\")".to_string()),
        identity_formula: None,
        array_ref: None,
    });
    // B2 (row=1, col=1): SUMIFS(...)/2
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 1, 1),
        row: 1,
        col: 1,
        value: CellValue::number(0.0),
        formula: Some("SUMIFS(A1:A100,A1:A100,\">50\")/2".to_string()),
        identity_formula: None,
        array_ref: None,
    });
    // B3 (row=2, col=1): SUMIFS(...)+10
    cell_data.push(CellData {
        cell_id: cell_uuid(0, 2, 1),
        row: 2,
        col: 1,
        value: CellValue::number(0.0),
        formula: Some("SUMIFS(A1:A100,A1:A100,\">50\")+10".to_string()),
        identity_formula: None,
        array_ref: None,
    });

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_uuid(0),
            name: "Sheet1".to_string(),
            rows: 200,
            cols: 26,
            cells: cell_data,
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
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // sum(51..100) = 3775
    assert_mirror_number(&mirror, 0, 0, 1, 3775.0);
    assert_mirror_number(&mirror, 0, 1, 1, 1887.5);
    assert_mirror_number(&mirror, 0, 2, 1, 3785.0);

    // set A75 (row=74, col=0) = 1000
    let _r = set(&mut core, &mut mirror, 0, 74, 0, "1000");

    // New sum = 3775 - 75 + 1000 = 4700
    assert_mirror_number(&mirror, 0, 0, 1, 4700.0);
    assert_mirror_number(&mirror, 0, 1, 1, 2350.0);
    assert_mirror_number(&mirror, 0, 2, 1, 4710.0);
}

// ---------------------------------------------------------------------------
// Test 12: CRITICAL — Spill shrink cache invalidation (Finding A2)
// A1="=SEQUENCE(10)" → 1..10. B1="=SUM(A1:A10)"=55.
// set A1="=SEQUENCE(5)" → A1..A5=1..5, A6..A10=Null. B1=15.
// ---------------------------------------------------------------------------
#[test]
fn test_spill_shrink_cache_invalidation() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        100,
        26,
        vec![
            (0, 0, CellValue::number(0.0), Some("SEQUENCE(10)")),
            (0, 1, CellValue::number(0.0), Some("SUM(A1:A10)")),
        ],
    )]);
    let _r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // Initial: B1 = 55
    assert_mirror_number(&mirror, 0, 0, 1, 55.0);

    // Shrink spill
    let _r = set(&mut core, &mut mirror, 0, 0, 0, "=SEQUENCE(5)");

    // A1 = 1 (origin cell), A2:A5 = 2..5 (spill targets — position-based lookup)
    assert_mirror_number(&mirror, 0, 0, 0, 1.0);
    for i in 1u32..5 {
        assert_pos_number(&mirror, 0, i, 0, (i + 1) as f64);
    }

    // A6:A10 must be Null (cleared spill targets — position-based lookup)
    assert_pos_null(&mirror, 0, 5, 0);
    assert_pos_null(&mirror, 0, 6, 0);
    assert_pos_null(&mirror, 0, 7, 0);
    assert_pos_null(&mirror, 0, 8, 0);
    assert_pos_null(&mirror, 0, 9, 0);

    // B1 must be 15, NOT 55
    assert_mirror_number(&mirror, 0, 0, 1, 15.0);
}
