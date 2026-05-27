use super::*;

// =========================================================================
// Aggregation Prepass Integration Tests
// =========================================================================

/// Build a snapshot for same-sheet COUNTIFS testing.
///
/// Single sheet with 20 data rows + 10 formula rows:
///   Col A (0): Category — repeating "Alpha", "Beta", "Gamma", "Delta" (5 each)
///   Col B (1): Region — repeating "East", "West" (alternating)
///   Col C (2): Value — row * 10.0 (10, 20, 30, ..., 200)
///   Col D (3): Formula criteria source — copies of category values for rows 0..9
///   Col E (4): COUNTIFS formulas — =COUNTIFS(A$1:A$20, D{row+1})  (10 rows)
///   Col F (5): SUMIFS formulas — =SUMIFS(C$1:C$20, A$1:A$20, D{row+1})
///   Col G (6): AVERAGEIFS formulas — =AVERAGEIFS(C$1:C$20, A$1:A$20, D{row+1})
fn agg_same_sheet_snapshot() -> WorkbookSnapshot {
    let sid = "00000000-0000-0000-0000-000000000001";
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];

    let mut cells = Vec::new();
    let mut id_counter = 0x1000u128;

    // 20 data rows in cols A, B, C
    for row in 0..20u32 {
        let cat = categories[(row % 4) as usize];
        let region = if row % 2 == 0 { "East" } else { "West" };
        let value = (row + 1) as f64 * 10.0;

        // Col A: category
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: region
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::Text(region.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col C: value
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::number(value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows (rows 0-9) with criteria in col D and formulas in cols E, F, G
    for row in 0..10u32 {
        let cat = categories[(row % 4) as usize];

        // Col D: criteria value (same as category for this row's formula lookup)
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // Col E: COUNTIFS(A$1:A$20, D{row+1})
        id_counter += 1;
        let countifs_id = format!("00000000-0000-0000-0000-{:012x}", id_counter);
        cells.push(CellData {
            cell_id: countifs_id,
            row,
            col: 4,
            value: CellValue::number(0.0),
            formula: Some(format!("=COUNTIFS(A$1:A$20,D{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col F: SUMIFS(C$1:C$20, A$1:A$20, D{row+1})
        id_counter += 1;
        let sumifs_id = format!("00000000-0000-0000-0000-{:012x}", id_counter);
        cells.push(CellData {
            cell_id: sumifs_id,
            row,
            col: 5,
            value: CellValue::number(0.0),
            formula: Some(format!("=SUMIFS(C$1:C$20,A$1:A$20,D{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col G: AVERAGEIFS(C$1:C$20, A$1:A$20, D{row+1})
        id_counter += 1;
        let averageifs_id = format!("00000000-0000-0000-0000-{:012x}", id_counter);
        cells.push(CellData {
            cell_id: averageifs_id,
            row,
            col: 6,
            value: CellValue::number(0.0),
            formula: Some(format!("=AVERAGEIFS(C$1:C$20,A$1:A$20,D{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
            cols: 7,
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
    }
}

/// Expected values for same-sheet agg prepass test:
///   Categories cycle: Alpha(0,4,8,12,16), Beta(1,5,9,13,17), Gamma(2,6,10,14,18), Delta(3,7,11,15,19)
///   Each category has 5 rows.
///   Values = (row+1)*10, so:
///     Alpha rows: 10,50,90,130,170 → sum=450, avg=90
///     Beta rows:  20,60,100,140,180 → sum=500, avg=100
///     Gamma rows: 30,70,110,150,190 → sum=550, avg=110
///     Delta rows: 40,80,120,160,200 → sum=600, avg=120
fn expected_agg_values() -> Vec<(f64, f64, f64)> {
    // (count, sum, average) for each formula row 0..9
    let counts = [5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0];
    let sums = [
        450.0, 500.0, 550.0, 600.0, 450.0, 500.0, 550.0, 600.0, 450.0, 500.0,
    ];
    let avgs = [
        90.0, 100.0, 110.0, 120.0, 90.0, 100.0, 110.0, 120.0, 90.0, 100.0,
    ];

    (0..10).map(|i| (counts[i], sums[i], avgs[i])).collect()
}

#[test]
fn test_agg_prepass_same_sheet_countifs() {
    let snap = agg_same_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let expected = expected_agg_values();

    // Find COUNTIFS cell IDs (col E = col 4)
    // Cell IDs start at 0x103d for row 0 col 4 formulas
    // We need to look up by (sheet, row, col) position instead
    let sheet_id = sid(1);
    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 4))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected[row as usize].0).abs() < 1e-10,
                    "COUNTIFS row {}: expected {}, got {}",
                    row,
                    expected[row as usize].0,
                    n.get()
                ),
                other => panic!("COUNTIFS row {}: expected number, got {:?}", row, other),
            }
        } else {
            panic!("No cell at row {}, col 4", row);
        }
    }
}

#[test]
fn test_agg_prepass_same_sheet_sumifs() {
    let snap = agg_same_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let expected = expected_agg_values();
    let sheet_id = sid(1);

    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 5))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected[row as usize].1).abs() < 1e-10,
                    "SUMIFS row {}: expected {}, got {}",
                    row,
                    expected[row as usize].1,
                    n.get()
                ),
                other => panic!("SUMIFS row {}: expected number, got {:?}", row, other),
            }
        } else {
            panic!("No cell at row {}, col 5", row);
        }
    }
}

#[test]
fn test_agg_prepass_same_sheet_averageifs() {
    let snap = agg_same_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let expected = expected_agg_values();
    let sheet_id = sid(1);

    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 6))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected[row as usize].2).abs() < 1e-10,
                    "AVERAGEIFS row {}: expected {}, got {}",
                    row,
                    expected[row as usize].2,
                    n.get()
                ),
                other => panic!("AVERAGEIFS row {}: expected number, got {:?}", row, other),
            }
        } else {
            panic!("No cell at row {}, col 6", row);
        }
    }
}

/// Build a snapshot with two sheets for cross-sheet COUNTIFS testing.
///
/// Sheet "Data" (id 1): 20 rows with categories in col A, values in col B
/// Sheet "Report" (id 2): 10 formula rows with:
///   Col A (0): criteria values
///   Col B (1): =COUNTIFS(Data!A$1:A$20, A{row+1})
///   Col C (2): =SUMIFS(Data!B$1:B$20, Data!A$1:A$20, A{row+1})
fn agg_cross_sheet_snapshot() -> WorkbookSnapshot {
    let data_sid = "00000000-0000-0000-0000-000000000001";
    let report_sid = "00000000-0000-0000-0000-000000000002";
    let categories = ["Red", "Blue", "Green"];

    let mut data_cells = Vec::new();
    let mut report_cells = Vec::new();
    let mut id_counter = 0x2000u128;

    // Data sheet: 20 rows
    for row in 0..20u32 {
        let cat = categories[(row % 3) as usize];
        let value = (row + 1) as f64 * 5.0;

        // Col A: category
        id_counter += 1;
        data_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: value
        id_counter += 1;
        data_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number(value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // Report sheet: 10 formula rows
    for row in 0..10u32 {
        let cat = categories[(row % 3) as usize];

        // Col A: criteria value
        id_counter += 1;
        report_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // Col B: =COUNTIFS(Data!A$1:A$20, A{row+1})
        id_counter += 1;
        report_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number(0.0),
            formula: Some(format!("=COUNTIFS(Data!A$1:A$20,A{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col C: =SUMIFS(Data!B$1:B$20, Data!A$1:A$20, A{row+1})
        id_counter += 1;
        report_cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::number(0.0),
            formula: Some(format!("=SUMIFS(Data!B$1:B$20,Data!A$1:A$20,A{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: data_sid.to_string(),
                name: "Data".to_string(),
                rows: 20,
                cols: 2,
                cells: data_cells,
                ranges: vec![],
            },
            SheetSnapshot {
                id: report_sid.to_string(),
                name: "Report".to_string(),
                rows: 10,
                cols: 3,
                cells: report_cells,
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
    }
}

#[test]
fn test_agg_prepass_cross_sheet_countifs() {
    // Red appears at rows 0,3,6,9,12,15,18 → 7 times
    // Blue appears at rows 1,4,7,10,13,16,19 → 7 times
    // Green appears at rows 2,5,8,11,14,17 → 6 times
    let snap = agg_cross_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let report_sid = sid(2);
    let expected_counts: [f64; 10] = [7.0, 7.0, 6.0, 7.0, 7.0, 6.0, 7.0, 7.0, 6.0, 7.0];

    for row in 0..10u32 {
        if let Some(cell_id) =
            mirror.resolve_cell_id(&report_sid, cell_types::SheetPos::new(row, 1))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected_counts[row as usize]).abs() < 1e-10,
                    "Cross-sheet COUNTIFS row {}: expected {}, got {}",
                    row,
                    expected_counts[row as usize],
                    n.get()
                ),
                other => panic!(
                    "Cross-sheet COUNTIFS row {}: expected number, got {:?}",
                    row, other
                ),
            }
        } else {
            panic!("No cell at Report row {}, col 1", row);
        }
    }
}

#[test]
fn test_agg_prepass_cross_sheet_sumifs() {
    // Red rows: 0,3,6,9,12,15,18 → values: 5,20,35,50,65,80,95 → sum=350
    // Blue rows: 1,4,7,10,13,16,19 → values: 10,25,40,55,70,85,100 → sum=385
    // Green rows: 2,5,8,11,14,17 → values: 15,30,45,60,75,90 → sum=315
    let snap = agg_cross_sheet_snapshot();

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let report_sid = sid(2);
    let expected_sums: [f64; 10] = [
        350.0, 385.0, 315.0, 350.0, 385.0, 315.0, 350.0, 385.0, 315.0, 350.0,
    ];

    for row in 0..10u32 {
        if let Some(cell_id) =
            mirror.resolve_cell_id(&report_sid, cell_types::SheetPos::new(row, 2))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - expected_sums[row as usize]).abs() < 1e-10,
                    "Cross-sheet SUMIFS row {}: expected {}, got {}",
                    row,
                    expected_sums[row as usize],
                    n.get()
                ),
                other => panic!(
                    "Cross-sheet SUMIFS row {}: expected number, got {:?}",
                    row, other
                ),
            }
        } else {
            panic!("No cell at Report row {}, col 2", row);
        }
    }
}

#[cfg(feature = "native")]
fn wrapped_sumifs_parallel_snapshot() -> WorkbookSnapshot {
    let sid = "00000000-0000-0000-0000-000000000001";
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];
    let formula_count = level_eval::PARALLEL_THRESHOLD + 100;
    let mut cells = Vec::new();
    let mut id_counter = 0x9000u128;

    for row in 0..20u32 {
        let cat = categories[(row % 4) as usize];
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::number((row + 1) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    for row in 0..formula_count as u32 {
        let cat = categories[(row % 4) as usize];
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 4,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 5,
            value: CellValue::number(0.0),
            formula: Some(format!(
                "=IFERROR(SUMIFS(C$1:C$20,A$1:A$20,E{}),0)",
                row + 1
            )),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_string(),
            name: "Sheet1".to_string(),
            rows: formula_count as u32 + 20,
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
    }
}

#[cfg(feature = "native")]
#[test]
fn test_wrapped_sumifs_warm_cache_seeds_parallel_eval() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, wrapped_sumifs_parallel_snapshot())
        .unwrap();

    compute_functions::helpers::sumifs_result_cache::reset_diagnostics();
    let sheet_id = sid(1);
    let source_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 2))
        .expect("source value cell");
    core.set_cell(&mut mirror, &sheet_id, source_id, 0, 2, "1000")
        .unwrap();

    let diag = compute_functions::helpers::sumifs_result_cache::diagnostics();
    assert!(
        diag.builds >= 1,
        "warm prepass should build at least one SUMIFS result map: {:?}",
        diag
    );
    assert!(
        diag.seeds > 0,
        "parallel evaluation should seed warmed SUMIFS data into rayon TLS: {:?}",
        diag
    );
    assert!(
        diag.hits >= level_eval::PARALLEL_THRESHOLD as u64,
        "wrapped SUMIFS formulas should hit seeded warm cache during parallel eval: {:?}",
        diag
    );
}

#[cfg(feature = "native")]
#[test]
fn test_sumifs_worker_tls_entries_do_not_survive_recalc_epoch() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, wrapped_sumifs_parallel_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let formula_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 5))
        .expect("formula cell");
    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(45.0))
    );

    let source_id = mirror
        .resolve_cell_id(&sheet_id, cell_types::SheetPos::new(0, 2))
        .expect("source value cell");
    core.set_cell(&mut mirror, &sheet_id, source_id, 0, 2, "1000")
        .unwrap();

    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(1044.0))
    );
}

#[test]
fn test_sumifs_cache_preserves_criteria_order_for_multiple_layouts() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let cells = vec![
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009001".to_string(),
            row: 0,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009002".to_string(),
            row: 1,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009003".to_string(),
            row: 2,
            col: 0,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009004".to_string(),
            row: 0,
            col: 1,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009005".to_string(),
            row: 1,
            col: 1,
            value: CellValue::Text("S".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009006".to_string(),
            row: 2,
            col: 1,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009007".to_string(),
            row: 0,
            col: 2,
            value: CellValue::number(10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009008".to_string(),
            row: 1,
            col: 2,
            value: CellValue::number(20.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-000000009009".to_string(),
            row: 2,
            col: 2,
            value: CellValue::number(30.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900a".to_string(),
            row: 0,
            col: 4,
            value: CellValue::Text("X".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900b".to_string(),
            row: 0,
            col: 6,
            value: CellValue::Text("N".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: "00000000-0000-0000-0000-00000000900c".to_string(),
            row: 0,
            col: 7,
            value: CellValue::number(0.0),
            formula: Some(
                "=IFERROR(SUMIFS(C$1:C$3,A$1:A$3,E1,B$1:B$3,G1)+SUMIFS(C$1:C$3,B$1:B$3,G1,A$1:A$3,E1),0)"
                    .to_string(),
            ),
            identity_formula: None,
            array_ref: None,
        },
    ];
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
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

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();
    let formula_id = CellId::from_uuid_str("00000000-0000-0000-0000-00000000900c").unwrap();

    assert_eq!(
        core.get_cell_value(&mirror, &formula_id).cloned(),
        Some(CellValue::number(80.0))
    );
}

/// Test single-criteria functions: COUNTIF, SUMIF, AVERAGEIF
#[test]
fn test_agg_prepass_single_criteria_functions() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let categories = [
        "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y", "X", "Y",
        "X", "Y",
    ];
    // Values: 1..20
    let mut cells = Vec::new();
    let mut id_counter = 0x3000u128;

    for row in 0..20u32 {
        // Col A: category
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(categories[row as usize].into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: value = row + 1
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number((row + 1) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows with criteria in col C, formulas in cols D(COUNTIF), E(SUMIF), F(AVERAGEIF)
    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };

        // Col C: criteria
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // Col D: =COUNTIF(A$1:A$20, C{row+1})
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!("=COUNTIF(A$1:A$20,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col E: =SUMIF(A$1:A$20, C{row+1}, B$1:B$20)
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 4,
            value: CellValue::number(0.0),
            formula: Some(format!("=SUMIF(A$1:A$20,C{},B$1:B$20)", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // Col F: =AVERAGEIF(A$1:A$20, C{row+1}, B$1:B$20)
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 5,
            value: CellValue::number(0.0),
            formula: Some(format!("=AVERAGEIF(A$1:A$20,C{},B$1:B$20)", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
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

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // X rows: 0,2,4,6,8,10,12,14,16,18 → count=10, values: 1,3,5,7,9,11,13,15,17,19 → sum=100, avg=10
    // Y rows: 1,3,5,7,9,11,13,15,17,19 → count=10, values: 2,4,6,8,10,12,14,16,18,20 → sum=110, avg=11
    let sheet_id = sid(1);
    for row in 0..10u32 {
        let (exp_count, exp_sum, exp_avg) = if row % 2 == 0 {
            (10.0, 100.0, 10.0) // X
        } else {
            (10.0, 110.0, 11.0) // Y
        };

        // COUNTIF (col D = 3)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_count).abs() < 1e-10,
                    "COUNTIF row {}: expected {}, got {}",
                    row,
                    exp_count,
                    n.get()
                ),
                other => panic!("COUNTIF row {}: expected number, got {:?}", row, other),
            }
        }

        // SUMIF (col E = 4)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 4))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_sum).abs() < 1e-10,
                    "SUMIF row {}: expected {}, got {}",
                    row,
                    exp_sum,
                    n.get()
                ),
                other => panic!("SUMIF row {}: expected number, got {:?}", row, other),
            }
        }

        // AVERAGEIF (col F = 5)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 5))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_avg).abs() < 1e-10,
                    "AVERAGEIF row {}: expected {}, got {}",
                    row,
                    exp_avg,
                    n.get()
                ),
                other => panic!("AVERAGEIF row {}: expected number, got {:?}", row, other),
            }
        }
    }
}

/// Test MAXIFS and MINIFS return 0.0 when no rows match (Excel behavior)
#[test]
fn test_agg_prepass_maxifs_minifs() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let mut cells = Vec::new();
    let mut id_counter = 0x4000u128;

    // 15 data rows: category "A" or "B", values 10..150
    for row in 0..15u32 {
        let cat = if row % 2 == 0 { "A" } else { "B" };
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number((row + 1) as f64 * 10.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows with criteria in col C, MAXIFS in col D, MINIFS in col E
    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "A" } else { "B" };
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        // MAXIFS
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!("=MAXIFS(B$1:B$15,A$1:A$15,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });

        // MINIFS
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 4,
            value: CellValue::number(0.0),
            formula: Some(format!("=MINIFS(B$1:B$15,A$1:A$15,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 15,
            cols: 5,
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

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // "A" rows: 0,2,4,6,8,10,12,14 → values: 10,30,50,70,90,110,130,150 → max=150, min=10
    // "B" rows: 1,3,5,7,9,11,13 → values: 20,40,60,80,100,120,140 → max=140, min=20
    let sheet_id = sid(1);
    for row in 0..10u32 {
        let (exp_max, exp_min) = if row % 2 == 0 {
            (150.0, 10.0) // A
        } else {
            (140.0, 20.0) // B
        };

        // MAXIFS (col 3)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_max).abs() < 1e-10,
                    "MAXIFS row {}: expected {}, got {}",
                    row,
                    exp_max,
                    n.get()
                ),
                other => panic!("MAXIFS row {}: expected number, got {:?}", row, other),
            }
        }

        // MINIFS (col 4)
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 4))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_min).abs() < 1e-10,
                    "MINIFS row {}: expected {}, got {}",
                    row,
                    exp_min,
                    n.get()
                ),
                other => panic!("MINIFS row {}: expected number, got {:?}", row, other),
            }
        }
    }
}

/// Test AVERAGEIFS returns #DIV/0! when no rows match the criteria
#[test]
fn test_agg_prepass_averageifs_no_match_div0() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let mut cells = Vec::new();
    let mut id_counter = 0x5000u128;

    // 10 data rows with category "Exists" only
    for row in 0..10u32 {
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text("Exists".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number((row + 1) as f64),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows looking for "Missing" — should get #DIV/0! for AVERAGEIFS
    for row in 0..10u32 {
        // criteria
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text("Missing".into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // AVERAGEIFS
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!("=AVERAGEIFS(B$1:B$10,A$1:A$10,C{})", row + 1)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
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

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    for row in 0..10u32 {
        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            assert_eq!(
                val,
                CellValue::Error(CellError::Div0, None),
                "AVERAGEIFS row {} with no match should return #DIV/0!, got {:?}",
                row,
                val
            );
        }
    }
}

/// Test mixed static + dynamic criteria: =COUNTIFS(A:A, D{row}, B:B, ">50")
#[test]
fn test_agg_prepass_mixed_static_dynamic() {
    let sid_str = "00000000-0000-0000-0000-000000000001";
    let mut cells = Vec::new();
    let mut id_counter = 0x6000u128;

    // 20 data rows
    for row in 0..20u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };
        let value = (row + 1) as f64 * 10.0; // 10, 20, 30, ..., 200

        // Col A: category
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 0,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        // Col B: value
        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 1,
            value: CellValue::number(value),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    // 10 formula rows: criteria col C, formula col D
    // =COUNTIFS(A$1:A$20, C{row+1}, B$1:B$20, ">100")
    for row in 0..10u32 {
        let cat = if row % 2 == 0 { "X" } else { "Y" };

        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 2,
            value: CellValue::Text(cat.into()),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });

        id_counter += 1;
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", id_counter),
            row,
            col: 3,
            value: CellValue::number(0.0),
            formula: Some(format!(
                "=COUNTIFS(A$1:A$20,C{},B$1:B$20,\">100\")",
                row + 1
            )),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid_str.to_string(),
            name: "Sheet1".to_string(),
            rows: 20,
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

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    // X rows: 0,2,4,6,8,10,12,14,16,18 → values: 10,30,50,70,90,110,130,150,170,190
    //   where value > 100: 110,130,150,170,190 → count=5
    // Y rows: 1,3,5,7,9,11,13,15,17,19 → values: 20,40,60,80,100,120,140,160,180,200
    //   where value > 100: 120,140,160,180,200 → count=5
    let sheet_id = sid(1);
    for row in 0..10u32 {
        let exp_count = 5.0;

        if let Some(cell_id) = mirror.resolve_cell_id(&sheet_id, cell_types::SheetPos::new(row, 3))
        {
            let val = core
                .get_cell_value(&mirror, &cell_id)
                .cloned()
                .unwrap_or(CellValue::Null);
            match val {
                CellValue::Number(n) => assert!(
                    (n.get() - exp_count).abs() < 1e-10,
                    "Mixed criteria COUNTIFS row {}: expected {}, got {}",
                    row,
                    exp_count,
                    n.get()
                ),
                other => panic!(
                    "Mixed criteria COUNTIFS row {}: expected number, got {:?}",
                    row, other
                ),
            }
        }
    }
}
