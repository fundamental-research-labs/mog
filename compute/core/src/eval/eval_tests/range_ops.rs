//! RangeOp evaluation (expr:expr) and whole-column reference tests.

use super::*;
use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};

// -----------------------------------------------------------------------
// RangeOp evaluation (expr:expr range operator)
// -----------------------------------------------------------------------

/// Helper: build a CellReference AST node at (row, col) on the given sheet.
fn cellref(sheet: SheetId, row: u32, col: u32) -> ASTNode {
    ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional { sheet, row, col },
        abs_row: false,
        abs_col: false,
    })
}

/// Helper: build a Range AST node from (sr,sc) to (er,ec) on the given sheet.
fn range(sheet: SheetId, sr: u32, sc: u32, er: u32, ec: u32) -> ASTNode {
    ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet,
            row: sr,
            col: sc,
        },
        end: CellRef::Positional {
            sheet,
            row: er,
            col: ec,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    })
}

#[test]
fn test_range_op_cell_refs() {
    // CellRef(1,0):CellRef(3,2) → 3×3 array from (1,0) to (3,2)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::RangeOp {
        start: Box::new(cellref(s, 1, 0)),
        end: Box::new(cellref(s, 3, 2)),
    };
    let result = eval(&node, &ctx);
    // Values: row*10+col
    assert_eq!(
        result,
        CellValue::from_rows(vec![
            vec![
                CellValue::number(10.0),
                CellValue::number(11.0),
                CellValue::number(12.0)
            ],
            vec![
                CellValue::number(20.0),
                CellValue::number(21.0),
                CellValue::number(22.0)
            ],
            vec![
                CellValue::number(30.0),
                CellValue::number(31.0),
                CellValue::number(32.0)
            ],
        ])
    );
}

#[test]
fn test_range_op_index_index() {
    // INDEX(A0:E4, 2, 1):INDEX(A0:E4, 2, 3) → row 1, cols 0-2
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = range(s, 0, 0, 4, 4);
    let idx1 = func(
        "INDEX",
        vec![arr.clone(), ASTNode::Number(2.0), ASTNode::Number(1.0)],
    );
    let idx2 = func(
        "INDEX",
        vec![arr, ASTNode::Number(2.0), ASTNode::Number(3.0)],
    );
    let node = ASTNode::RangeOp {
        start: Box::new(idx1),
        end: Box::new(idx2),
    };
    let result = eval(&node, &ctx);
    // Row 1, cols 0-2: values 10, 11, 12
    assert_eq!(
        result,
        CellValue::from_rows(vec![vec![
            CellValue::number(10.0),
            CellValue::number(11.0),
            CellValue::number(12.0)
        ],])
    );
}

#[test]
fn test_range_op_index_single_cell() {
    // INDEX(range, 2, 1):INDEX(range, 2, 1) → single cell (1,0) = 10
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = range(s, 0, 0, 4, 4);
    let idx = func(
        "INDEX",
        vec![arr.clone(), ASTNode::Number(2.0), ASTNode::Number(1.0)],
    );
    let idx2 = func(
        "INDEX",
        vec![arr, ASTNode::Number(2.0), ASTNode::Number(1.0)],
    );
    let node = ASTNode::RangeOp {
        start: Box::new(idx),
        end: Box::new(idx2),
    };
    let result = eval(&node, &ctx);
    // Single cell → scalar value
    assert_eq!(result, CellValue::number(10.0));
}

#[test]
fn test_range_op_index_column_range() {
    // INDEX(range, 0, 1):INDEX(range, 0, 2) → columns 0,1 of full range (5 rows)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = range(s, 0, 0, 4, 4);
    let idx1 = func(
        "INDEX",
        vec![arr.clone(), ASTNode::Number(0.0), ASTNode::Number(1.0)],
    );
    let idx2 = func(
        "INDEX",
        vec![arr, ASTNode::Number(0.0), ASTNode::Number(2.0)],
    );
    let node = ASTNode::RangeOp {
        start: Box::new(idx1),
        end: Box::new(idx2),
    };
    let result = eval(&node, &ctx);
    // 5 rows × 2 cols (cols 0-1)
    assert_eq!(
        result,
        CellValue::from_rows(vec![
            vec![CellValue::number(0.0), CellValue::number(1.0)],
            vec![CellValue::number(10.0), CellValue::number(11.0)],
            vec![CellValue::number(20.0), CellValue::number(21.0)],
            vec![CellValue::number(30.0), CellValue::number(31.0)],
            vec![CellValue::number(40.0), CellValue::number(41.0)],
        ])
    );
}

#[test]
fn test_range_op_offset() {
    // OFFSET(A0, 1, 0):OFFSET(A0, 3, 0) → cells (1,0) to (3,0) = 10, 20, 30
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let base = cellref(s, 0, 0);
    let off1 = func(
        "OFFSET",
        vec![base.clone(), ASTNode::Number(1.0), ASTNode::Number(0.0)],
    );
    let off2 = func(
        "OFFSET",
        vec![base, ASTNode::Number(3.0), ASTNode::Number(0.0)],
    );
    let node = ASTNode::RangeOp {
        start: Box::new(off1),
        end: Box::new(off2),
    };
    let result = eval(&node, &ctx);
    assert_eq!(
        result,
        CellValue::from_rows(vec![
            vec![CellValue::number(10.0)],
            vec![CellValue::number(20.0)],
            vec![CellValue::number(30.0)],
        ])
    );
}

#[test]
fn test_range_op_offset_with_height() {
    // OFFSET(A0,0,0,3,1):OFFSET(A0,0,1,3,1) → range (0,0)-(2,1)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let base = cellref(s, 0, 0);
    let off1 = func(
        "OFFSET",
        vec![
            base.clone(),
            ASTNode::Number(0.0),
            ASTNode::Number(0.0),
            ASTNode::Number(3.0),
            ASTNode::Number(1.0),
        ],
    );
    let off2 = func(
        "OFFSET",
        vec![
            base,
            ASTNode::Number(0.0),
            ASTNode::Number(1.0),
            ASTNode::Number(3.0),
            ASTNode::Number(1.0),
        ],
    );
    let node = ASTNode::RangeOp {
        start: Box::new(off1),
        end: Box::new(off2),
    };
    let result = eval(&node, &ctx);
    assert_eq!(
        result,
        CellValue::from_rows(vec![
            vec![CellValue::number(0.0), CellValue::number(1.0)],
            vec![CellValue::number(10.0), CellValue::number(11.0)],
            vec![CellValue::number(20.0), CellValue::number(21.0)],
        ])
    );
}

#[test]
fn test_range_op_unsupported_function() {
    // SUM(1):SUM(2) → #VALUE! (SUM cannot produce a reference)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::RangeOp {
        start: Box::new(func("SUM", vec![ASTNode::Number(1.0)])),
        end: Box::new(func("SUM", vec![ASTNode::Number(2.0)])),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_range_op_mixed_cell_and_index() {
    // A1:INDEX(range, 3, 3) → (0,0) to (2,2) = 3×3 array
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = range(s, 0, 0, 4, 4);
    let idx = func(
        "INDEX",
        vec![arr, ASTNode::Number(3.0), ASTNode::Number(3.0)],
    );
    let node = ASTNode::RangeOp {
        start: Box::new(cellref(s, 0, 0)),
        end: Box::new(idx),
    };
    let result = eval(&node, &ctx);
    assert_eq!(
        result,
        CellValue::from_rows(vec![
            vec![
                CellValue::number(0.0),
                CellValue::number(1.0),
                CellValue::number(2.0)
            ],
            vec![
                CellValue::number(10.0),
                CellValue::number(11.0),
                CellValue::number(12.0)
            ],
            vec![
                CellValue::number(20.0),
                CellValue::number(21.0),
                CellValue::number(22.0)
            ],
        ])
    );
}

#[test]
fn test_range_op_sum_of_index_range() {
    // SUM(INDEX(range, 2, 1):INDEX(range, 4, 1)) → sum of cells (1,0)+(2,0)+(3,0) = 10+20+30 = 60
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = range(s, 0, 0, 4, 4);
    let idx1 = func(
        "INDEX",
        vec![arr.clone(), ASTNode::Number(2.0), ASTNode::Number(1.0)],
    );
    let idx2 = func(
        "INDEX",
        vec![arr, ASTNode::Number(4.0), ASTNode::Number(1.0)],
    );
    let range_op = ASTNode::RangeOp {
        start: Box::new(idx1),
        end: Box::new(idx2),
    };
    let node = func("SUM", vec![range_op]);
    let result = eval(&node, &ctx);
    assert_eq!(result, CellValue::number(60.0));
}

// -----------------------------------------------------------------------
// Reference intersection operator
// -----------------------------------------------------------------------

fn intersection(left: ASTNode, right: ASTNode) -> ASTNode {
    binop(compute_parser::BinOp::Intersect, left, right)
}

#[test]
fn test_intersection_sum_overlapping_ranges() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "SUM",
        vec![intersection(range(s, 0, 0, 1, 1), range(s, 0, 1, 2, 2))],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(12.0));
}

#[test]
fn test_intersection_single_cell_returns_scalar() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = intersection(range(s, 0, 0, 1, 1), range(s, 1, 1, 2, 2));
    assert_eq!(eval(&node, &ctx), CellValue::number(11.0));
}

#[test]
fn test_intersection_no_overlap_returns_null_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = intersection(range(s, 0, 0, 1, 0), range(s, 0, 2, 1, 2));
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Null, None));
}

#[test]
fn test_nested_intersection_no_overlap_returns_null_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let nested = intersection(range(s, 0, 0, 1, 0), range(s, 0, 2, 1, 2));
    let node = intersection(nested, range(s, 0, 0, 1, 2));
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Null, None));
}

#[test]
fn test_intersection_preserves_range_source_in_aggregate() {
    let cells = vec![
        CellData {
            cell_id: cell_uuid(0, 0),
            row: 0,
            col: 0,
            value: CellValue::Boolean(true),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(1, 0),
            row: 1,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(2, 0),
            row: 2,
            col: 0,
            value: CellValue::number(5.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ];
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: TEST_SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
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
    let mirror = CellMirror::from_snapshot(snapshot).unwrap();
    let sheet = mirror.sheet_by_name("Sheet1").unwrap();
    let ctx = make_ctx(&mirror, sheet);
    let node = func(
        "SUM",
        vec![intersection(
            range(sheet, 0, 0, 2, 0),
            range(sheet, 0, 0, 2, 0),
        )],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(5.0));
}

#[test]
fn test_nested_intersection_inside_binary_expression() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = binop(
        compute_parser::BinOp::Add,
        intersection(range(s, 0, 0, 1, 1), range(s, 1, 1, 2, 2)),
        ASTNode::Number(4.0),
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(15.0));
}

// =======================================================================
// Whole-column reference tests
// =======================================================================

/// Helper: build a ColumnRange (e.g. A:A) AST node.
fn col_range(sheet: SheetId, col: u32) -> ASTNode {
    ASTNode::Range(RangeRef {
        start: CellRef::Positional { sheet, row: 0, col },
        end: CellRef::Positional {
            sheet,
            row: u32::MAX,
            col,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::ColumnRange,
    })
}

#[test]
fn test_xlookup_non_null_in_whole_column_ref() {
    // XLOOKUP for a non-Null value in a whole-column ref should work normally.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // XLOOKUP(20, A:A, B:B) — col A has [0,10,20,30,40], match at row 2
    let node = func(
        "XLOOKUP",
        vec![
            ASTNode::Number(20.0),
            col_range(s, 0), // A:A
            col_range(s, 1), // B:B
        ],
    );
    let result = eval(&node, &ctx);
    // Row 2, col 1 = 2*10+1 = 21
    assert_eq!(result, CellValue::number(21.0));
}

#[test]
fn test_xlookup_null_in_whole_column_ref() {
    // XLOOKUP(Null, A:A, B:B) where A:A has [0,10,20,30,40].
    // Null coerces to 0 for comparisons, so it matches the 0 at row 0.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // Reference to an empty cell (row 99 has no data in test mirror)
    let empty_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 99,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });

    let node = func(
        "XLOOKUP",
        vec![
            empty_ref,       // Null lookup value (empty cell)
            col_range(s, 0), // A:A (fully populated: [0,10,20,30,40])
            col_range(s, 1), // B:B
        ],
    );
    let result = eval(&node, &ctx);
    // Null does not match 0 — returns Null (no match in whole-column ref)
    assert_eq!(result, CellValue::Null);
}

#[test]
fn test_xlookup_null_in_cell_range_matches_zero() {
    // XLOOKUP(Null, A1:A5, B1:B5) where A1:A5 = [0,10,20,30,40].
    // Null coerces to 0 for comparisons, so it matches A1=0.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let empty_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 99,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });

    let range_a = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 4,
            col: 0,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let range_b = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 1,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 4,
            col: 1,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });

    let node = func("XLOOKUP", vec![empty_ref, range_a, range_b]);
    let result = eval(&node, &ctx);
    // Null does not match 0 in finite range — returns #N/A
    assert_eq!(result, CellValue::Error(CellError::Na, None));
}

#[test]
fn test_countblank_whole_column_ref() {
    // COUNTBLANK(A:A) on a fully populated column.
    // test_mirror has 5 non-null values in column A, clamped to 5 rows.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let node = func("COUNTBLANK", vec![col_range(s, 0)]);
    let result = eval(&node, &ctx);
    assert_eq!(result, CellValue::number(0.0));
}
