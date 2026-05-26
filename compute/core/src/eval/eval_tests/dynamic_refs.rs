//! Omitted argument defaults, OFFSET, and INDIRECT tests.

use super::*;

// -----------------------------------------------------------------------
// Omitted argument default propagation
// -----------------------------------------------------------------------

#[test]
fn test_omitted_arg_evaluates_to_null() {
    // ASTNode::Omitted should evaluate to CellValue::Null (not Number(0.0))
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(eval(&ASTNode::Omitted, &ctx), CellValue::Null);
}

#[test]
fn test_log_omitted_base_defaults_to_10() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // LOG(100, ) — omitted base should default to 10
    let result = eval(
        &func("LOG", vec![ASTNode::Number(100.0), ASTNode::Omitted]),
        &ctx,
    );
    assert_eq!(result, CellValue::number(2.0));
}

#[test]
fn test_left_omitted_num_chars_defaults_to_1() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // LEFT("hello", ) — omitted num_chars should default to 1
    let result = eval(
        &func(
            "LEFT",
            vec![ASTNode::Text("hello".into()), ASTNode::Omitted],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::Text("h".into()));
}

#[test]
fn test_right_omitted_num_chars_defaults_to_1() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // RIGHT("hello", ) — omitted num_chars should default to 1
    let result = eval(
        &func(
            "RIGHT",
            vec![ASTNode::Text("hello".into()), ASTNode::Omitted],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::Text("o".into()));
}

#[test]
fn test_round_no_digits_defaults_to_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // ROUND(3.14159) with just one arg — no Omitted node, just one arg
    #[allow(clippy::approx_constant)]
    let val = 3.14159;
    let result = eval(&func("ROUND", vec![ASTNode::Number(val)]), &ctx);
    assert_eq!(result, CellValue::number(3.0));
}

#[test]
fn test_explicit_zero_not_replaced_by_default() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // LOG(100, 0) — explicit 0 should NOT be replaced by default 10
    // LOG base 0 is invalid → should return #NUM! error
    let result = eval(
        &func("LOG", vec![ASTNode::Number(100.0), ASTNode::Number(0.0)]),
        &ctx,
    );
    assert!(matches!(result, CellValue::Error(..)));
}

// -----------------------------------------------------------------------
// OFFSET tests
// -----------------------------------------------------------------------
// Test mirror: 5x5 grid where cell(r,c) = Number(r*10 + c)
// So cell(0,0)=0, cell(1,2)=12, cell(2,3)=23, cell(4,4)=44, etc.

#[test]
fn test_offset_single_cell() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(A1, 2, 3) -> cell(2,3) = 23
    let base = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![base, ASTNode::Number(2.0), ASTNode::Number(3.0)],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::number(23.0));
}

#[test]
fn test_offset_with_height_width() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(A1, 1, 1, 2, 2) -> 2x2 range starting at (1,1)
    // = [[11,12],[21,22]]
    let base = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![
                base,
                ASTNode::Number(1.0),
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(2.0),
            ],
        ),
        &ctx,
    );
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.cols(), 2);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(11.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(12.0));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::number(21.0));
            assert_eq!(*arr.get(1, 1).unwrap(), CellValue::number(22.0));
        }
        _ => panic!("Expected Array, got {:?}", result),
    }
}

#[test]
fn test_offset_negative_offset() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(C3, -1, -1) -> cell(1,1) = 11
    // C3 is (row=2, col=2)
    let base = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 2,
            col: 2,
        },
        abs_row: false,
        abs_col: false,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![base, ASTNode::Number(-1.0), ASTNode::Number(-1.0)],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::number(11.0));
}

#[test]
fn test_offset_out_of_bounds() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(A1, -1, 0) -> row=-1 -> #REF!
    let base = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![base, ASTNode::Number(-1.0), ASTNode::Number(0.0)],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_offset_zero_height_returns_ref() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(A1, 0, 0, 0, 1) -> height=0 -> #REF!
    let base = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![
                base,
                ASTNode::Number(0.0),
                ASTNode::Number(0.0),
                ASTNode::Number(0.0),
                ASTNode::Number(1.0),
            ],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_offset_from_range() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(A1:B2, 1, 1) -> 2x2 range starting at (1,1)
    // = [[11,12],[21,22]]
    let base = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 1,
            col: 1,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![base, ASTNode::Number(1.0), ASTNode::Number(1.0)],
        ),
        &ctx,
    );
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.cols(), 2);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(11.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(12.0));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::number(21.0));
            assert_eq!(*arr.get(1, 1).unwrap(), CellValue::number(22.0));
        }
        _ => panic!("Expected Array, got {:?}", result),
    }
}

#[test]
fn test_offset_range_with_resize() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(A1:B2, 0, 0, 3, 1) -> resize to 3 rows x 1 col starting at (0,0)
    // = [[0],[10],[20]]
    let base = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 1,
            col: 1,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![
                base,
                ASTNode::Number(0.0),
                ASTNode::Number(0.0),
                ASTNode::Number(3.0),
                ASTNode::Number(1.0),
            ],
        ),
        &ctx,
    );
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.row(0), &[CellValue::number(0.0)]);
            assert_eq!(arr.row(1), &[CellValue::number(10.0)]);
            assert_eq!(arr.row(2), &[CellValue::number(20.0)]);
        }
        _ => panic!("Expected Array, got {:?}", result),
    }
}

#[test]
fn test_offset_omitted_height_width() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // OFFSET(A1, 1, 1, , ) -> height/width omitted -> defaults to base (1x1)
    // -> cell(1,1) = 11
    let base = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let result = eval(
        &func(
            "OFFSET",
            vec![
                base,
                ASTNode::Number(1.0),
                ASTNode::Number(1.0),
                ASTNode::Omitted,
                ASTNode::Omitted,
            ],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::number(11.0));
}

// -----------------------------------------------------------------------
// INDIRECT tests
// -----------------------------------------------------------------------

#[test]
fn test_indirect_simple_cell() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("C3") -> cell(2,2) = 22
    let result = eval(&func("INDIRECT", vec![ASTNode::Text("C3".into())]), &ctx);
    assert_eq!(result, CellValue::number(22.0));
}

#[test]
fn test_indirect_absolute_ref() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("$B$2") -> cell(1,1) = 11
    let result = eval(&func("INDIRECT", vec![ASTNode::Text("$B$2".into())]), &ctx);
    assert_eq!(result, CellValue::number(11.0));
}

#[test]
fn test_indirect_range() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("A1:B2") -> 2x2 array [[0,1],[10,11]]
    let result = eval(&func("INDIRECT", vec![ASTNode::Text("A1:B2".into())]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.cols(), 2);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(0.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(1.0));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::number(10.0));
            assert_eq!(*arr.get(1, 1).unwrap(), CellValue::number(11.0));
        }
        _ => panic!("Expected Array, got {:?}", result),
    }
}

#[test]
fn test_indirect_with_sheet_name() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("Sheet1!D4") -> cell(3,3) = 33
    let result = eval(
        &func("INDIRECT", vec![ASTNode::Text("Sheet1!D4".into())]),
        &ctx,
    );
    assert_eq!(result, CellValue::number(33.0));
}

#[test]
fn test_indirect_invalid_ref() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("not_a_ref") -> #REF!
    let result = eval(
        &func("INDIRECT", vec![ASTNode::Text("not_a_ref".into())]),
        &ctx,
    );
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_indirect_empty_string() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("") -> #REF!
    let result = eval(&func("INDIRECT", vec![ASTNode::Text("".into())]), &ctx);
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_indirect_r1c1_not_supported() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("R1C1", FALSE) -> #REF! (R1C1 not supported)
    let result = eval(
        &func(
            "INDIRECT",
            vec![ASTNode::Text("R1C1".into()), ASTNode::Boolean(false)],
        ),
        &ctx,
    );
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_indirect_bad_sheet_name() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("NoSuchSheet!A1") -> #REF!
    let result = eval(
        &func("INDIRECT", vec![ASTNode::Text("NoSuchSheet!A1".into())]),
        &ctx,
    );
    assert_eq!(result, CellValue::Error(CellError::Ref, None));
}

#[test]
fn test_indirect_quoted_sheet_name() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // INDIRECT("'Sheet1'!E5") -> cell(4,4) = 44
    let result = eval(
        &func("INDIRECT", vec![ASTNode::Text("'Sheet1'!E5".into())]),
        &ctx,
    );
    assert_eq!(result, CellValue::number(44.0));
}

#[test]
fn test_offset_in_sum() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // SUM(OFFSET(A1, 0, 0, 3, 1)) -> SUM of cells (0,0),(1,0),(2,0) = 0+10+20 = 30
    let offset_node = func(
        "OFFSET",
        vec![
            ASTNode::CellReference(CellRefNode {
                reference: CellRef::Positional {
                    sheet: s,
                    row: 0,
                    col: 0,
                },
                abs_row: false,
                abs_col: false,
            }),
            ASTNode::Number(0.0),
            ASTNode::Number(0.0),
            ASTNode::Number(3.0),
            ASTNode::Number(1.0),
        ],
    );
    let result = eval(&func("SUM", vec![offset_node]), &ctx);
    assert_eq!(result, CellValue::number(30.0));
}
