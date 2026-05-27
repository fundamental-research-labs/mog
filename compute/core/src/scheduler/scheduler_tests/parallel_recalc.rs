use super::*;

// -----------------------------------------------------------------------
// Parallel recalc correctness tests
// -----------------------------------------------------------------------

#[test]
fn test_parallel_recalc_basic_independent() {
    // 100 independent formula cells, all at level 0
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let count = 100;

    let mut cells = Vec::new();
    for i in 0..count {
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", 0x100 + i),
            row: i as u32,
            col: 0,
            value: CellValue::number(i as f64 + 1.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }
    for i in 0..count {
        let row_label = format!("A{}", i + 1);
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", 0x200 + i),
            row: i as u32,
            col: 1,
            value: CellValue::number(0.0),
            formula: Some(format!("={}*2", row_label)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 200,
            cols: 26,
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    for i in 0..count {
        let b_id =
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x200 + i)).unwrap();
        let val = core.get_cell_value(&mirror, &b_id).unwrap();
        assert_eq!(
            *val,
            CellValue::number((i as f64 + 1.0) * 2.0),
            "B{} mismatch",
            i + 1
        );
    }
}

#[test]
fn test_parallel_recalc_chain() {
    // A1=1, B1=A1+1, C1=B1+1, D1=C1+1
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=C1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(2.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(3.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(4.0)
    );

    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "10")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(11.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(12.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(13.0)
    );
}

#[test]
fn test_parallel_recalc_diamond() {
    // Diamond: A1=10, B1=A1*2, C1=A1+5, D1=B1+C1
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+5".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+C1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(20.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(15.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(35.0)
    );

    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(200.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x12)).unwrap(),
        CellValue::number(105.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(305.0)
    );
}

#[test]
fn test_parallel_recalc_wide_level() {
    // 50 independent formulas at level 0 (wider than PARALLEL_THRESHOLD)
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let width = 50;

    let mut cells = Vec::new();
    cells.push(CellData {
        cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
        row: 0,
        col: 0,
        value: CellValue::number(7.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    });

    for i in 0..width {
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-{:012x}", 0x100 + i),
            row: (i + 1) as u32,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some(format!("=A1+{}", i)),
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 200,
            cols: 26,
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let formula_cells: Vec<CellId> = (0..width)
        .map(|i| {
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x100 + i)).unwrap()
        })
        .collect();

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&formula_cells, &mirror)
        .into_value();
    assert_eq!(levels.len(), 1, "All cells should be at level 0");
    assert_eq!(levels[0].len(), width);

    for i in 0..width {
        let cell_id =
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x100 + i)).unwrap();
        let val = core.get_cell_value(&mirror, &cell_id).unwrap();
        assert_eq!(*val, CellValue::number(7.0 + i as f64));
    }

    // Update source and verify cascade
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    for i in 0..width {
        let cell_id =
            CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", 0x100 + i)).unwrap();
        let val = core.get_cell_value(&mirror, &cell_id).unwrap();
        assert_eq!(*val, CellValue::number(100.0 + i as f64));
    }
}

#[test]
fn test_group_by_level_diamond_pattern() {
    // B1=A1*2, C1=A1+5, D1=B1+C1
    // Levels: [B1, C1], [D1]
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+5".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+C1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1 = cid(0x11);
    let c1 = cid(0x12);
    let d1 = cid(0x13);

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[b1, c1, d1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 2);
    assert_eq!(levels[0].len(), 2);
    assert!(levels[0].contains(&b1));
    assert!(levels[0].contains(&c1));
    assert_eq!(levels[1], vec![d1]);
}

#[test]
fn test_small_level_stays_sequential() {
    // 3 cells at level 0 — below PARALLEL_THRESHOLD
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+3".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1 = cid(0x11);
    let c1 = cid(0x12);
    let d1 = cid(0x13);

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[b1, c1, d1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 1);
    assert_eq!(levels[0].len(), 3);

    assert_eq!(
        *core.get_cell_value(&mirror, &b1).unwrap(),
        CellValue::number(6.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1).unwrap(),
        CellValue::number(7.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &d1).unwrap(),
        CellValue::number(8.0)
    );
}

#[test]
fn test_parallel_matches_sequential_complex_graph() {
    // Multi-level graph:
    // A1=1, A2=2, A3=3
    // B1=A1+A2, B2=A2+A3
    // C1=B1+B2
    // D1=C1*2
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::number(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::number(3.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000020".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+A2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000021".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::number(0.0),
                    formula: Some("=A2+A3".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000030".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=B1+B2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000040".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=C1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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

    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let b1 = cid(0x20);
    let b2 = cid(0x21);
    let c1 = cid(0x30);
    let d1 = cid(0x40);

    // Verify levels
    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[b1, b2, c1, d1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 3);
    assert_eq!(levels[0].len(), 2);
    assert!(levels[0].contains(&b1));
    assert!(levels[0].contains(&b2));
    assert_eq!(levels[1], vec![c1]);
    assert_eq!(levels[2], vec![d1]);

    // B1=3, B2=5, C1=8, D1=16
    assert_eq!(
        *core.get_cell_value(&mirror, &b1).unwrap(),
        CellValue::number(3.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &b2).unwrap(),
        CellValue::number(5.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1).unwrap(),
        CellValue::number(8.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &d1).unwrap(),
        CellValue::number(16.0)
    );

    // Change A2 to 20
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x11), 1, 0, "20")
        .unwrap();

    // B1=21, B2=23, C1=44, D1=88
    assert_eq!(
        *core.get_cell_value(&mirror, &b1).unwrap(),
        CellValue::number(21.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &b2).unwrap(),
        CellValue::number(23.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1).unwrap(),
        CellValue::number(44.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &d1).unwrap(),
        CellValue::number(88.0)
    );
}
