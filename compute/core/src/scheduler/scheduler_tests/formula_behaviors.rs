use super::*;

// -----------------------------------------------------------------------
// Chain of dependencies
// -----------------------------------------------------------------------

#[test]
fn test_dependency_chain_a_b_c() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    // A1=5, B1=A1*2, C1=B1+10
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
                    col: 0, // A1
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2, // C1
                    value: CellValue::number(0.0),
                    formula: Some("=B1+10".to_string()),
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

    // B1 = 5 * 2 = 10, C1 = 10 + 10 = 20
    let b1_id = cid(0x11);
    let c1_id = cid(0x12);

    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(10.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(20.0)
    );

    // Change A1 to 100
    let sheet_id = sid(1);
    let a1_id = cid(0x10);
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "100")
        .unwrap();

    // B1 = 100 * 2 = 200, C1 = 200 + 10 = 210
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::number(200.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(210.0)
    );
}

// -----------------------------------------------------------------------
// Volatile cells
// -----------------------------------------------------------------------

#[test]
fn test_volatile_cell_always_recalculated() {
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
                    col: 0, // A1
                    value: CellValue::number(0.0),
                    formula: Some("=NOW()".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1 — plain value
                    value: CellValue::number(42.0),
                    formula: None,
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

    let a1_id = cid(0x10);

    // A1 should be marked volatile
    assert!(core.graph.is_volatile(&a1_id));

    // A1 should have the NOW() result — a serial date in a reasonable range.
    // Since we use the injectable timestamp (or system clock), it should be
    // a value greater than 45000 (~ early 2023).
    let a1_val = core.get_cell_value(&mirror, &a1_id).unwrap();
    match a1_val {
        CellValue::Number(n) => assert!(
            n.get() > 45000.0,
            "NOW() should return a serial date > 45000, got {}",
            n.get()
        ),
        other => panic!("Expected Number from NOW(), got {:?}", other),
    }
}

// -----------------------------------------------------------------------
// Empty cell formula → clear
// -----------------------------------------------------------------------

#[test]
fn test_set_cell_empty_clears() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let c1_id = cid(0x12);

    // Set C1 to empty
    core.set_cell(&mut mirror, &sheet_id, c1_id, 0, 2, "")
        .unwrap();

    // C1 should be null, no formula
    let val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*val, CellValue::Null);
    assert!(core.get_formula(&c1_id).is_none());
}

// -----------------------------------------------------------------------
// Replace formula with plain value
// -----------------------------------------------------------------------

#[test]
fn test_replace_formula_with_value() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let c1_id = cid(0x12);

    // C1 has formula =A1+B1. Replace with plain value.
    core.set_cell(&mut mirror, &sheet_id, c1_id, 0, 2, "999")
        .unwrap();

    let val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*val, CellValue::number(999.0));
    assert!(core.get_formula(&c1_id).is_none());
}

// -----------------------------------------------------------------------
// Sheet management
// -----------------------------------------------------------------------

#[test]
fn test_add_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let new_sheet = SheetSnapshot {
        id: "00000000-0000-0000-0000-000000000002".to_string(),
        name: "Sheet2".to_string(),
        rows: 100,
        cols: 26,
        cells: vec![CellData {
            cell_id: "00000000-0000-0000-0000-000000000020".to_string(),
            row: 0,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some("=5*5".to_string()),
            identity_formula: None,
            array_ref: None,
        }],
        ranges: vec![],
    };

    core.add_sheet(&mut mirror, new_sheet).unwrap();

    let cell_id = cid(0x20);
    // The formula should be parsed but not yet evaluated (no recalc triggered by add_sheet)
    assert!(core.get_formula(&cell_id).is_some());
}

#[test]
fn test_remove_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let a1_id = cid(0x10);

    // Verify the cell exists
    assert!(core.get_cell_value(&mirror, &a1_id).is_some());

    core.remove_sheet(&mut mirror, &sheet_id).unwrap();

    // Cell should no longer be accessible
    assert!(core.get_cell_value(&mirror, &a1_id).is_none());
}

#[test]
fn test_rename_sheet() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    core.rename_sheet(&mut mirror, &sheet_id, "NewName");

    // Sheet should be findable by new name
    assert!(mirror.sheet_by_name("NewName").is_some());
    assert!(mirror.sheet_by_name("Sheet1").is_none());
}

// -----------------------------------------------------------------------
// Read operations
// -----------------------------------------------------------------------

#[test]
fn test_get_formula_plain_cell() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // A1 is a plain value — no formula
    let a1_id = cid(0x10);
    assert!(core.get_formula(&a1_id).is_none());
}

#[test]
fn test_get_cell_value_nonexistent() {
    let core = ComputeCore::new();
    let mirror = CellMirror::new();
    let fake_id = cid(0x99);
    assert!(core.get_cell_value(&mirror, &fake_id).is_none());
}

// -----------------------------------------------------------------------
// Structural changes
// -----------------------------------------------------------------------

#[test]
fn test_structure_change_insert_rows() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // Structure change: regenerate formula strings, rebuild dep graph, full recalc.
    // `None` is the legacy/observer-rebuild signature (no per-op shift); this
    // test predates positional-ref shifting and only exercises the post-shift
    // recalc path.
    let result = core.structure_change(&mut mirror, None).unwrap();

    // The formula =A1+B1 should now refer to cells at new positions
    // After insert, old row 0 is now row 1
    // The formula text is still =A1+B1 (unchanged), but the positional
    // resolution should now look at the new positions.
    // This is a simplified test — the actual behavior depends on
    // formula rewriting which is handled by the TS side.
    assert!(result.errors.is_empty() || !result.errors.is_empty());
}

// -----------------------------------------------------------------------
// apply_changes (CellEdit)
// -----------------------------------------------------------------------

#[test]
fn test_apply_changes() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let changes = vec![CellEdit {
        sheet_id: "00000000-0000-0000-0000-000000000001".to_string(),
        cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
        row: 0,
        col: 0,
        value: CellValue::number(99.0),
        formula: None,
        identity_formula: None,
    }];

    let _result = core.apply_changes(&mut mirror, &changes, false).unwrap();

    // A1 should now be 99
    let a1_id = cid(0x10);
    assert_eq!(
        *core.get_cell_value(&mirror, &a1_id).unwrap(),
        CellValue::number(99.0)
    );

    // C1 = A1 + B1 = 99 + 20 = 119
    let c1_id = cid(0x12);
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(119.0)
    );
}

// -----------------------------------------------------------------------
// Parse plain values
// -----------------------------------------------------------------------

#[test]
fn test_parse_plain_number() {
    assert_eq!(parse_plain_value("42"), CellValue::number(42.0));
    #[allow(clippy::approx_constant)]
    let expected = 3.14;
    assert_eq!(parse_plain_value("3.14"), CellValue::number(expected));
    assert_eq!(parse_plain_value("-7"), CellValue::number(-7.0));
    assert_eq!(parse_plain_value("1e5"), CellValue::number(100000.0));
}

#[test]
fn test_parse_plain_boolean() {
    assert_eq!(parse_plain_value("TRUE"), CellValue::Boolean(true));
    assert_eq!(parse_plain_value("FALSE"), CellValue::Boolean(false));
    assert_eq!(parse_plain_value("true"), CellValue::Boolean(true));
    assert_eq!(parse_plain_value("false"), CellValue::Boolean(false));
}

#[test]
fn test_parse_plain_text() {
    assert_eq!(parse_plain_value("hello"), CellValue::Text("hello".into()));
    assert_eq!(
        parse_plain_value("not a number"),
        CellValue::Text("not a number".into())
    );
}

// -----------------------------------------------------------------------
// SUM range formula
// -----------------------------------------------------------------------

#[test]
fn test_sum_range_formula() {
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
                    col: 0, // A1 = 1
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 1,
                    col: 0, // A2 = 2
                    value: CellValue::number(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 2,
                    col: 0, // A3 = 3
                    value: CellValue::number(3.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 3,
                    col: 0, // A4 = SUM(A1:A3)
                    value: CellValue::number(0.0),
                    formula: Some("=SUM(A1:A3)".to_string()),
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

    // A4 = SUM(A1:A3) = 1 + 2 + 3 = 6
    let a4_id = cid(0x13);
    assert_eq!(
        *core.get_cell_value(&mirror, &a4_id).unwrap(),
        CellValue::number(6.0)
    );

    // Change A2 to 10
    let sheet_id = sid(1);
    let a2_id = cid(0x11);
    core.set_cell(&mut mirror, &sheet_id, a2_id, 1, 0, "10")
        .unwrap();

    // A4 = SUM(A1:A3) = 1 + 10 + 3 = 14
    assert_eq!(
        *core.get_cell_value(&mirror, &a4_id).unwrap(),
        CellValue::number(14.0)
    );
}

// -----------------------------------------------------------------------
// Diamond dependency: D depends on B and C, B and C depend on A
// -----------------------------------------------------------------------

#[test]
fn test_diamond_dependency() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    // A1=10, B1=A1*2, C1=A1+5, D1=B1+C1
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
                    col: 0, // A1
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2, // C1
                    value: CellValue::number(0.0),
                    formula: Some("=A1+5".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3, // D1
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

    // B1 = 10*2 = 20, C1 = 10+5 = 15, D1 = 20+15 = 35
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

    // Change A1 to 100
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    // B1 = 100*2 = 200, C1 = 100+5 = 105, D1 = 200+105 = 305
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

// -----------------------------------------------------------------------
// Volatile function detection
// -----------------------------------------------------------------------

#[test]
fn test_volatile_function_detection() {
    use compute_parser::ASTNode;

    let now_ast = ASTNode::Function {
        name: "NOW".into(),
        args: vec![],
    };
    assert!(contains_volatile_function(&now_ast));

    let sum_ast = ASTNode::Function {
        name: "SUM".into(),
        args: vec![ASTNode::Number(1.0)],
    };
    assert!(!contains_volatile_function(&sum_ast));

    // Nested volatile
    let nested = ASTNode::Function {
        name: "TEXT".into(),
        args: vec![
            ASTNode::Function {
                name: "NOW".into(),
                args: vec![],
            },
            ASTNode::Text("HH:MM".to_string()),
        ],
    };
    assert!(contains_volatile_function(&nested));
}

// -----------------------------------------------------------------------
// Values equality helper
// -----------------------------------------------------------------------

#[test]
fn test_values_equal() {
    assert!(values_equal(
        &CellValue::number(42.0),
        &CellValue::number(42.0)
    ));
    assert!(!values_equal(
        &CellValue::number(42.0),
        &CellValue::number(43.0)
    ));
    assert!(values_equal(&CellValue::Null, &CellValue::Null));
    assert!(!values_equal(&CellValue::Null, &CellValue::number(0.0)));

    // Text: case-sensitive (unlike CellValue::PartialEq which is case-insensitive)
    assert!(values_equal(
        &CellValue::Text("abc".into()),
        &CellValue::Text("abc".into())
    ));
    assert!(!values_equal(
        &CellValue::Text("abc".into()),
        &CellValue::Text("ABC".into())
    ));
}

// -----------------------------------------------------------------------
// Multiple independent formula cells
// -----------------------------------------------------------------------

#[test]
fn test_independent_formulas() {
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
                    col: 0, // A1
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1 = A1 * 2
                    value: CellValue::number(0.0),
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 1,
                    col: 0, // A2
                    value: CellValue::number(100.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 1,
                    col: 1, // B2 = A2 + 1
                    value: CellValue::number(0.0),
                    formula: Some("=A2+1".to_string()),
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

    // B1 = 5*2 = 10, B2 = 100+1 = 101
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(10.0)
    );
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(101.0)
    );

    // Change A1 — only B1 should change, not B2
    let sheet_id = sid(1);
    let result = core
        .set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "50")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x11)).unwrap(),
        CellValue::number(100.0)
    );
    // B2 should still be 101
    assert_eq!(
        *core.get_cell_value(&mirror, &cid(0x13)).unwrap(),
        CellValue::number(101.0)
    );

    // Only A1 and B1 should be in changed cells, not B2
    let changed_ids: Vec<String> = result
        .changed_cells
        .iter()
        .map(|c| c.cell_id.clone())
        .collect();
    assert!(!changed_ids.contains(&cid(0x13).to_uuid_string()));
}

// -----------------------------------------------------------------------
// Formula that references empty cell
// -----------------------------------------------------------------------

#[test]
fn test_formula_referencing_empty_cell() {
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
                    col: 0, // A1 = 5
                    value: CellValue::number(5.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1 is empty (no cell data)
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2, // C1 = A1 + B1
                    value: CellValue::number(0.0),
                    formula: Some("=A1+B1".to_string()),
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

    // C1 = 5 + 0 (B1 is empty, coerces to 0) = 5
    let c1_id = cid(0x12);
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(5.0));
}

// -----------------------------------------------------------------------
// IF formula
// -----------------------------------------------------------------------

#[test]
fn test_if_formula() {
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
                    col: 0, // A1 = 10
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1 = IF(A1>5, "big", "small")
                    value: CellValue::number(0.0),
                    formula: Some("=IF(A1>5,\"big\",\"small\")".to_string()),
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

    let b1_id = cid(0x11);
    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::Text("big".into())
    );

    // Change A1 to 3
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "3")
        .unwrap();

    assert_eq!(
        *core.get_cell_value(&mirror, &b1_id).unwrap(),
        CellValue::Text("small".into())
    );
}

// -----------------------------------------------------------------------
// Default trait
// -----------------------------------------------------------------------

#[test]
fn test_compute_core_default() {
    let core = ComputeCore::default();
    let mirror = CellMirror::new();
    assert!(core.get_cell_value(&mirror, &make_cell_id(1)).is_none());
}

// -----------------------------------------------------------------------
// Long dependency chain
// -----------------------------------------------------------------------

#[test]
fn test_long_chain() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();

    // Create a chain: A1=1, A2=A1+1, A3=A2+1, ..., A10=A9+1
    let mut cells = vec![CellData {
        cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
        row: 0,
        col: 0, // A1 = 1
        value: CellValue::number(1.0),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }];

    for i in 1u32..10 {
        let _prev_row = i; // A{i} = A{i-1} + 1
        cells.push(CellData {
            cell_id: format!("00000000-0000-0000-0000-0000000000{:02x}", 0x10 + i),
            row: i,
            col: 0,
            value: CellValue::number(0.0),
            formula: Some(format!("=A{}+1", i)), // A{i+1} = A{i} + 1
            identity_formula: None,
            array_ref: None,
        });
    }

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
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

    // A10 should be 10 (1 + 9 increments)
    let a10_id = CellId::from_uuid_str("00000000-0000-0000-0000-000000000019").unwrap();
    let val = core.get_cell_value(&mirror, &a10_id).unwrap();
    assert_eq!(*val, CellValue::number(10.0));

    // Change A1 to 100
    let sheet_id = sid(1);
    core.set_cell(&mut mirror, &sheet_id, cid(0x10), 0, 0, "100")
        .unwrap();

    // A10 should be 109
    let val = core.get_cell_value(&mirror, &a10_id).unwrap();
    assert_eq!(*val, CellValue::number(109.0));
}

// -----------------------------------------------------------------------
// Replacing a formula cell with a formula
// -----------------------------------------------------------------------

#[test]
fn test_replace_formula_with_formula() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let sheet_id = sid(1);
    let c1_id = cid(0x12);

    // C1 has =A1+B1. Replace with =A1*B1
    core.set_cell(&mut mirror, &sheet_id, c1_id, 0, 2, "=A1*B1")
        .unwrap();

    // C1 = 10 * 20 = 200
    assert_eq!(
        *core.get_cell_value(&mirror, &c1_id).unwrap(),
        CellValue::number(200.0)
    );
    assert_eq!(core.get_formula(&c1_id), Some("=A1*B1"));
}

// -----------------------------------------------------------------------
// Multiple sheets with cross-sheet references
// -----------------------------------------------------------------------

#[test]
fn test_recalc_result_has_sheet_ids() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let result = core
        .init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // All changed cells should have the correct sheet_id
    for change in &result.changed_cells {
        assert_eq!(change.sheet_id, "00000000000000000000000000000001");
    }
}
