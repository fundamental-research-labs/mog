use super::*;

// -----------------------------------------------------------------------
// extract_dependencies tests
// -----------------------------------------------------------------------

#[test]
fn test_extract_deps_cell_ref() {
    let cell_id = make_cell_id(42);
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(cell_id),
        abs_row: false,
        abs_col: false,
    });
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    assert_eq!(deps, vec![DepTarget::Cell(cell_id)]);
}

#[test]
fn test_extract_deps_binary_op() {
    let a = make_cell_id(1);
    let b = make_cell_id(2);
    let ast = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Add,
        left: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(a),
            abs_row: false,
            abs_col: false,
        })),
        right: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(b),
            abs_row: false,
            abs_col: false,
        })),
    };
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    assert!(deps.contains(&DepTarget::Cell(a)));
    assert!(deps.contains(&DepTarget::Cell(b)));
}

#[test]
fn test_extract_deps_positional_ref() {
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: make_sheet_id(1),
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    // Positional refs are tracked as 1x1 range deps so the graph can
    // find dependents by position (needed for spill propagation).
    assert_eq!(deps.len(), 1);
    match &deps[0] {
        DepTarget::Range(rect, _) => {
            assert_eq!(rect.sheet(), make_sheet_id(1));
            assert_eq!(rect.start_row(), 0);
            assert_eq!(rect.start_col(), 0);
            assert_eq!(rect.end_row(), 0);
            assert_eq!(rect.end_col(), 0);
        }
        other => panic!("expected Range dep, got {:?}", other),
    }
}

#[test]
fn test_extract_deps_deduplication() {
    let a = make_cell_id(1);
    // A1 + A1 should only have one dep
    let ast = ASTNode::BinaryOp {
        op: compute_parser::BinOp::Add,
        left: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(a),
            abs_row: false,
            abs_col: false,
        })),
        right: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Resolved(a),
            abs_row: false,
            abs_col: false,
        })),
    };
    let deps = extract_dependencies(&ast, &make_sheet_id(1));
    assert_eq!(deps.len(), 1);
    assert_eq!(deps[0], DepTarget::Cell(a));
}

// -----------------------------------------------------------------------
// subset_levels tests (formerly group_by_level)
// -----------------------------------------------------------------------

#[test]
fn test_group_by_level_linear_chain() {
    // A1=5, B1=A1*2, C1=B1+10 => 2 levels: [B1], [C1]
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
                    formula: Some("=A1*2".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
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

    let b1 = cid(0x11);
    let c1 = cid(0x12);

    let (levels, _cycle_cells) = core.graph.subset_levels(&[b1, c1], &mirror).into_value();
    assert_eq!(levels.len(), 2);
    assert_eq!(levels[0], vec![b1]);
    assert_eq!(levels[1], vec![c1]);
}

#[test]
fn test_group_by_level_parallel() {
    // C1=A1+B1, D1=C1+10, E1=C1*2
    // D1 and E1 both depend on C1. Levels: [C1], [D1, E1]
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
                    value: CellValue::number(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::number(0.0),
                    formula: Some("=A1+B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000013".to_string(),
                    row: 0,
                    col: 3,
                    value: CellValue::number(0.0),
                    formula: Some("=C1+10".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000014".to_string(),
                    row: 0,
                    col: 4,
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

    let c1 = cid(0x12);
    let d1 = cid(0x13);
    let e1 = cid(0x14);

    let (levels, _cycle_cells) = core
        .graph
        .subset_levels(&[c1, d1, e1], &mirror)
        .into_value();
    assert_eq!(levels.len(), 2);
    assert_eq!(levels[0], vec![c1]);
    assert_eq!(levels[1].len(), 2);
    assert!(levels[1].contains(&d1));
    assert!(levels[1].contains(&e1));
}

#[test]
fn test_group_by_level_single() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let c1 = cid(0x12);
    let (levels, _cycle_cells) = core.graph.subset_levels(&[c1], &mirror).into_value();
    assert_eq!(levels.len(), 1);
    assert_eq!(levels[0], vec![c1]);
}

#[test]
fn test_group_by_level_empty() {
    let core = ComputeCore::new();
    let mirror = CellMirror::new();
    let (levels, _cycle_cells) = core.graph.subset_levels(&[], &mirror).into_value();
    assert!(levels.is_empty());
}
