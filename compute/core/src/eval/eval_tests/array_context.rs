//! Array-context IF, TABLE pseudo-function, CELL function tests.

use super::*;

// -----------------------------------------------------------------------
// TABLE() pseudo-function returns #CALC! (not yet supported)
// -----------------------------------------------------------------------

#[test]
fn test_table_returns_calc_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // TABLE with two args — should return #CALC! immediately without evaluating args
    let node = func("TABLE", vec![ASTNode::Number(1.0), ASTNode::Number(2.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Calc, None));
}

#[test]
fn test_table_no_args_returns_calc_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("TABLE", vec![]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Calc, None));
}

// -----------------------------------------------------------------------
// Array-context IF
// -----------------------------------------------------------------------

#[test]
fn test_if_array_condition() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // IF({TRUE,FALSE,TRUE}, {10,20,30}, {40,50,60}) → {10,50,30}
    let cond = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Boolean(true),
            ASTNode::Boolean(false),
            ASTNode::Boolean(true),
        ]],
    };
    let val_true = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
            ASTNode::Number(30.0),
        ]],
    };
    let val_false = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(40.0),
            ASTNode::Number(50.0),
            ASTNode::Number(60.0),
        ]],
    };
    let node = func("IF", vec![cond, val_true, val_false]);
    match eval(&node, &ctx) {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(10.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(50.0));
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::number(30.0));
        }
        other => panic!("expected Array, got {:?}", other),
    }
}

#[test]
fn test_if_array_condition_with_scalar_values() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // IF({TRUE,FALSE,TRUE}, 99, 0) → {99,0,99}
    let cond = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Boolean(true),
            ASTNode::Boolean(false),
            ASTNode::Boolean(true),
        ]],
    };
    let node = func(
        "IF",
        vec![cond, ASTNode::Number(99.0), ASTNode::Number(0.0)],
    );
    match eval(&node, &ctx) {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(99.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(0.0));
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::number(99.0));
        }
        other => panic!("expected Array, got {:?}", other),
    }
}

#[test]
fn test_if_array_condition_error_propagation() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // IF({TRUE, #DIV/0!, FALSE}, 1, 2) → {1, #DIV/0!, 2}
    let cond = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Boolean(true),
            ASTNode::Error(CellError::Div0),
            ASTNode::Boolean(false),
        ]],
    };
    let node = func("IF", vec![cond, ASTNode::Number(1.0), ASTNode::Number(2.0)]);
    match eval(&node, &ctx) {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(1.0));
            assert_eq!(
                *arr.get(0, 1).unwrap(),
                CellValue::Error(CellError::Div0, None)
            );
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::number(2.0));
        }
        other => panic!("expected Array, got {:?}", other),
    }
}

#[test]
fn test_if_array_condition_missing_else() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // IF({TRUE,FALSE}, 5) → {5, FALSE} (missing else defaults to FALSE)
    let cond = ASTNode::Array {
        rows: vec![vec![ASTNode::Boolean(true), ASTNode::Boolean(false)]],
    };
    let node = func("IF", vec![cond, ASTNode::Number(5.0)]);
    match eval(&node, &ctx) {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 2);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(5.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::Boolean(false));
        }
        other => panic!("expected Array, got {:?}", other),
    }
}

#[test]
fn test_if_array_condition_2d() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // 2D array condition: IF({TRUE,FALSE;FALSE,TRUE}, {1,2;3,4}, {10,20;30,40})
    // → {1,20;30,4}
    let cond = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Boolean(true), ASTNode::Boolean(false)],
            vec![ASTNode::Boolean(false), ASTNode::Boolean(true)],
        ],
    };
    let val_true = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        ],
    };
    let val_false = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(10.0), ASTNode::Number(20.0)],
            vec![ASTNode::Number(30.0), ASTNode::Number(40.0)],
        ],
    };
    let node = func("IF", vec![cond, val_true, val_false]);
    match eval(&node, &ctx) {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(1.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(20.0));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::number(30.0));
            assert_eq!(*arr.get(1, 1).unwrap(), CellValue::number(4.0));
        }
        other => panic!("expected Array, got {:?}", other),
    }
}

// =======================================================================
// CELL function tests
// =======================================================================

#[test]
fn test_cell_row_positional() {
    // CELL("row", C5) should return 5 (1-based)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 4,
            col: 2,
        },
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("row".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::number(5.0));
}

#[test]
fn test_cell_col_positional() {
    // CELL("col", C5) should return 3 (1-based)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 4,
            col: 2,
        },
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("col".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn test_cell_address_positional() {
    // CELL("address", C5) should return "$C$5"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 4,
            col: 2,
        },
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("address".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::Text("$C$5".into()));
}

#[test]
fn test_cell_row_resolved() {
    // CELL("row", resolved_ref) should return 1-based row
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(cell_id_at(3, 1)),
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("row".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::number(4.0));
}

#[test]
fn test_cell_col_resolved() {
    // CELL("col", resolved_ref) should return 1-based col
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(cell_id_at(3, 1)),
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("col".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::number(2.0));
}

#[test]
fn test_cell_address_resolved() {
    // CELL("address", D4) should return "$D$4"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(cell_id_at(3, 3)),
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("address".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::Text("$D$4".into()));
}

#[test]
fn test_cell_row_range_returns_top_left() {
    // CELL("row", A2:C4) should return 3 (row of top-left cell, 1-based, row index 2)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let range_node = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 2,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 3,
            col: 2,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let node = func("CELL", vec![ASTNode::Text("row".into()), range_node]);
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn test_cell_col_range_returns_top_left() {
    // CELL("col", B2:D4) should return 2 (col of start cell, 1-based, col index 1)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let range_node = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 1,
            col: 1,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 3,
            col: 3,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let node = func("CELL", vec![ASTNode::Text("col".into()), range_node]);
    assert_eq!(eval(&node, &ctx), CellValue::number(2.0));
}

#[test]
fn test_cell_type_error_returns_v() {
    // CELL("type", <error_cell>) should return "v" (errors are values in Excel)
    // This tests that the error propagation bug is fixed
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "CELL",
        vec![
            ASTNode::Text("type".into()),
            ASTNode::Error(CellError::Div0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("v".into()));
}

#[test]
fn test_cell_type_na_error_returns_v() {
    // CELL("type", <#N/A>) should return "v"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "CELL",
        vec![ASTNode::Text("type".into()), ASTNode::Error(CellError::Na)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("v".into()));
}

#[test]
fn test_cell_contents_with_error_propagates() {
    // CELL("contents", <error_cell>) should propagate the error
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "CELL",
        vec![
            ASTNode::Text("contents".into()),
            ASTNode::Error(CellError::Div0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Div0, None));
}

#[test]
fn test_cell_no_args() {
    // CELL() with no arguments should return #VALUE!
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("CELL", vec![]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_cell_row_no_reference() {
    // CELL("row") with no second arg should return #N/A
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("CELL", vec![ASTNode::Text("row".into())]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

#[test]
fn test_cell_address_a1() {
    // CELL("address", A1) should return "$A$1"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("address".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::Text("$A$1".into()));
}

#[test]
fn test_cell_address_aa_col() {
    // CELL("address") for col 26 (AA) should return "$AA$1"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 26,
        },
        abs_row: false,
        abs_col: false,
    });
    let node = func("CELL", vec![ASTNode::Text("address".into()), ref_node]);
    assert_eq!(eval(&node, &ctx), CellValue::Text("$AA$1".into()));
}
