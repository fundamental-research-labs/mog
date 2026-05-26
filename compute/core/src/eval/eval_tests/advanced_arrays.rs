//! Array lookup values, IS*/NOT composition, SUMPRODUCT fused path, IFS/XLOOKUP broadcasting.

use super::*;

// -----------------------------------------------------------------------
// VLOOKUP / HLOOKUP array lookup_value support
// -----------------------------------------------------------------------

#[test]
fn test_vlookup_array_lookup() {
    // VLOOKUP({1,2,3}, table, 2, TRUE) should return {"a","b","c"}
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Text("a".into())],
            vec![ASTNode::Number(2.0), ASTNode::Text("b".into())],
            vec![ASTNode::Number(3.0), ASTNode::Text("c".into())],
        ],
    };
    let lookup_arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(2.0),
            ASTNode::Number(3.0),
        ]],
    };
    let node = func(
        "VLOOKUP",
        vec![
            lookup_arr,
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.get(0, 0), Some(&CellValue::Text("a".into())));
            assert_eq!(arr.get(0, 1), Some(&CellValue::Text("b".into())));
            assert_eq!(arr.get(0, 2), Some(&CellValue::Text("c".into())));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_vlookup_array_lookup_not_found() {
    // VLOOKUP({1,99,3}, table, 2, TRUE) → {"a", #N/A, "c"}
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Text("a".into())],
            vec![ASTNode::Number(2.0), ASTNode::Text("b".into())],
            vec![ASTNode::Number(3.0), ASTNode::Text("c".into())],
        ],
    };
    let lookup_arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(99.0),
            ASTNode::Number(3.0),
        ]],
    };
    let node = func(
        "VLOOKUP",
        vec![
            lookup_arr,
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0), Some(&CellValue::Text("a".into())));
            assert_eq!(arr.get(0, 1), Some(&CellValue::Error(CellError::Na, None)));
            assert_eq!(arr.get(0, 2), Some(&CellValue::Text("c".into())));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_vlookup_array_2d_lookup_rejected() {
    // VLOOKUP({1,2;3,4}, table, 2, TRUE) → #VALUE! (2D array rejected)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Text("a".into())],
            vec![ASTNode::Number(2.0), ASTNode::Text("b".into())],
        ],
    };
    let lookup_arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        ],
    };
    let node = func(
        "VLOOKUP",
        vec![
            lookup_arr,
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_hlookup_array_lookup() {
    // HLOOKUP({1,2,3}, table, 2, TRUE) should return {"a","b","c"}
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(3.0),
            ],
            vec![
                ASTNode::Text("a".into()),
                ASTNode::Text("b".into()),
                ASTNode::Text("c".into()),
            ],
        ],
    };
    let lookup_arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(2.0),
            ASTNode::Number(3.0),
        ]],
    };
    let node = func(
        "HLOOKUP",
        vec![
            lookup_arr,
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.get(0, 0), Some(&CellValue::Text("a".into())));
            assert_eq!(arr.get(0, 1), Some(&CellValue::Text("b".into())));
            assert_eq!(arr.get(0, 2), Some(&CellValue::Text("c".into())));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_hlookup_array_2d_lookup_rejected() {
    // HLOOKUP({1,2;3,4}, table, 2, TRUE) → #VALUE! (2D array rejected)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Text("a".into()), ASTNode::Text("b".into())],
        ],
    };
    let lookup_arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        ],
    };
    let node = func(
        "HLOOKUP",
        vec![
            lookup_arr,
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

// -----------------------------------------------------------------------
// IS* / NOT composition tests
// -----------------------------------------------------------------------

#[test]
fn test_not_isnumber_composition() {
    // NOT(ISNUMBER({1,"text",TRUE})) → {FALSE,TRUE,TRUE}
    // ISNUMBER(1)=TRUE  → NOT → FALSE
    // ISNUMBER("text")=FALSE → NOT → TRUE
    // ISNUMBER(TRUE)=FALSE → NOT → TRUE
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Text("text".into()),
            ASTNode::Boolean(true),
        ]],
    };
    let isnumber = func("ISNUMBER", vec![arr]);
    let result = eval(&func("NOT", vec![isnumber]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Boolean(false));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::Boolean(true));
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::Boolean(true));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_not_isblank_composition() {
    // NOT(ISBLANK({1,"",0}))
    // ISBLANK(1)=FALSE → NOT → TRUE
    // ISBLANK("")=FALSE → NOT → TRUE  (empty string is not blank in Excel)
    // ISBLANK(0)=FALSE → NOT → TRUE
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Text("".into()),
            ASTNode::Number(0.0),
        ]],
    };
    let isblank = func("ISBLANK", vec![arr]);
    let result = eval(&func("NOT", vec![isblank]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            // All non-blank values → ISBLANK returns FALSE → NOT returns TRUE
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Boolean(true));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::Boolean(true));
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::Boolean(true));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_sumproduct_not_isblank() {
    // SUMPRODUCT(NOT(ISBLANK({1,0,""})))
    // ISBLANK → {FALSE,FALSE,FALSE} → NOT → {TRUE,TRUE,TRUE}
    // SUMPRODUCT coerces booleans: TRUE=1 → 1+1+1 = 3
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(0.0),
            ASTNode::Text("".into()),
        ]],
    };
    let isblank = func("ISBLANK", vec![arr]);
    let not_isblank = func("NOT", vec![isblank]);
    let result = eval(&func("SUMPRODUCT", vec![not_isblank]), &ctx);
    assert_eq!(result, CellValue::number(3.0));
}

#[test]
fn test_sumproduct_text_empty_string_treated_as_zero() {
    // SUMPRODUCT({1,"",3}, {4,5,6}) = 1*4 + 0*5 + 3*6 = 22
    // Empty text "" should be treated as 0 in SUMPRODUCT
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr1 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Text("".into()),
            ASTNode::Number(3.0),
        ]],
    };
    let arr2 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(4.0),
            ASTNode::Number(5.0),
            ASTNode::Number(6.0),
        ]],
    };
    let result = eval(&func("SUMPRODUCT", vec![arr1, arr2]), &ctx);
    assert_eq!(result, CellValue::number(22.0));
}

#[test]
fn test_sumproduct_text_nonempty_string_treated_as_zero() {
    // SUMPRODUCT({1,"hello",3}, {4,5,6}) = 1*4 + 0*5 + 3*6 = 22
    // Non-empty text "hello" should be treated as 0 in SUMPRODUCT
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr1 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Text("hello".into()),
            ASTNode::Number(3.0),
        ]],
    };
    let arr2 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(4.0),
            ASTNode::Number(5.0),
            ASTNode::Number(6.0),
        ]],
    };
    let result = eval(&func("SUMPRODUCT", vec![arr1, arr2]), &ctx);
    assert_eq!(result, CellValue::number(22.0));
}

#[test]
fn test_sumproduct_error_propagates() {
    // SUMPRODUCT({1,#N/A,3}, {4,5,6}) → #N/A
    // Errors in arrays should still propagate
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr1 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Error(CellError::Na),
            ASTNode::Number(3.0),
        ]],
    };
    let arr2 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(4.0),
            ASTNode::Number(5.0),
            ASTNode::Number(6.0),
        ]],
    };
    let result = eval(&func("SUMPRODUCT", vec![arr1, arr2]), &ctx);
    assert_eq!(result, CellValue::Error(CellError::Na, None));
}

// -----------------------------------------------------------------------
// SUMPRODUCT: boolean array multiplication (fused path)
// -----------------------------------------------------------------------

#[test]
fn test_sumproduct_boolean_mul_chain() {
    // SUMPRODUCT(({TRUE;FALSE;TRUE}) * {10;20;30}) = 1*10 + 0*20 + 1*30 = 40
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let bools = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Boolean(true)],
            vec![ASTNode::Boolean(false)],
            vec![ASTNode::Boolean(true)],
        ],
    };
    let nums = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(10.0)],
            vec![ASTNode::Number(20.0)],
            vec![ASTNode::Number(30.0)],
        ],
    };
    let mul = binop(BinOp::Mul, bools, nums);
    let result = eval(&func("SUMPRODUCT", vec![mul]), &ctx);
    assert_eq!(result, CellValue::number(40.0));
}

#[test]
fn test_sumproduct_comparison_mul_pattern() {
    // SUMPRODUCT(({1;2;3;1;2} = 1) * {10;20;30;40;50})
    // Matches: rows 0(10) and 3(40) → 50
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let vals = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0)],
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
        ],
    };
    let cmp = binop(BinOp::Eq, vals, ASTNode::Number(1.0));
    let data = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(10.0)],
            vec![ASTNode::Number(20.0)],
            vec![ASTNode::Number(30.0)],
            vec![ASTNode::Number(40.0)],
            vec![ASTNode::Number(50.0)],
        ],
    };
    let mul = binop(BinOp::Mul, ASTNode::Paren(Box::new(cmp)), data);
    let result = eval(&func("SUMPRODUCT", vec![mul]), &ctx);
    assert_eq!(result, CellValue::number(50.0));
}

#[test]
fn test_sumproduct_double_boolean_criteria() {
    // SUMPRODUCT(({1;2;1;2} = 1) * ({10;20;30;40} > 15))
    // Row 0: (1=1)*(10>15) = TRUE*FALSE = 0
    // Row 1: (2=1)*(20>15) = FALSE*TRUE = 0
    // Row 2: (1=1)*(30>15) = TRUE*TRUE = 1
    // Row 3: (2=1)*(40>15) = FALSE*TRUE = 0
    // Sum = 1
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cats = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
        ],
    };
    let amounts = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(10.0)],
            vec![ASTNode::Number(20.0)],
            vec![ASTNode::Number(30.0)],
            vec![ASTNode::Number(40.0)],
        ],
    };
    let cond1 = ASTNode::Paren(Box::new(binop(BinOp::Eq, cats, ASTNode::Number(1.0))));
    let cond2 = ASTNode::Paren(Box::new(binop(BinOp::Gt, amounts, ASTNode::Number(15.0))));
    let mul = binop(BinOp::Mul, cond1, cond2);
    let result = eval(&func("SUMPRODUCT", vec![mul]), &ctx);
    assert_eq!(result, CellValue::number(1.0));
}

#[test]
fn test_sumproduct_date_multi_array_in_fused_path() {
    // SUMPRODUCT((DATE({2024;2024;2024}, {1;2;1}, 1) = DATE(2024,1,1)) * {100;200;300})
    // DATE produces 3 date serials: Jan, Feb, Jan
    // Comparison with Jan 1 2024: {TRUE;FALSE;TRUE}
    // Multiply by values: 100 + 0 + 300 = 400
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let years = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(2024.0)],
            vec![ASTNode::Number(2024.0)],
            vec![ASTNode::Number(2024.0)],
        ],
    };
    let months = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
            vec![ASTNode::Number(1.0)],
        ],
    };
    let date_arr = func("DATE", vec![years, months, ASTNode::Number(1.0)]);
    let target_date = func(
        "DATE",
        vec![
            ASTNode::Number(2024.0),
            ASTNode::Number(1.0),
            ASTNode::Number(1.0),
        ],
    );
    let comparison = ASTNode::Paren(Box::new(binop(BinOp::Eq, date_arr, target_date)));
    let values = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(100.0)],
            vec![ASTNode::Number(200.0)],
            vec![ASTNode::Number(300.0)],
        ],
    };
    let mul = binop(BinOp::Mul, comparison, values);
    let result = eval(&func("SUMPRODUCT", vec![mul]), &ctx);
    assert_eq!(result, CellValue::number(400.0));
}

#[test]
fn test_sumproduct_nested_year_month_date_pattern() {
    // SUMPRODUCT((DATE(YEAR({45292;45323;45292}), MONTH({45292;45323;45292}), 1) = 45292) * {10;20;30})
    // 45292 = 2024-01-01, 45323 = 2024-02-01
    // YEAR(45292)=2024, MONTH(45292)=1, DATE(2024,1,1)=45292
    // YEAR(45323)=2024, MONTH(45323)=2, DATE(2024,2,1)=45323
    // Comparison with 45292: {TRUE;FALSE;TRUE}
    // 10 + 0 + 30 = 40
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let serial_jan = 45292.0; // 2024-01-01
    let serial_feb = 45323.0; // 2024-02-01
    let serials = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(serial_jan)],
            vec![ASTNode::Number(serial_feb)],
            vec![ASTNode::Number(serial_jan)],
        ],
    };
    let serials2 = serials.clone();
    let year_arr = func("YEAR", vec![serials]);
    let month_arr = func("MONTH", vec![serials2]);
    let date_arr = func("DATE", vec![year_arr, month_arr, ASTNode::Number(1.0)]);
    let comparison = ASTNode::Paren(Box::new(binop(
        BinOp::Eq,
        date_arr,
        ASTNode::Number(serial_jan),
    )));
    let values = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(10.0)],
            vec![ASTNode::Number(20.0)],
            vec![ASTNode::Number(30.0)],
        ],
    };
    let mul = binop(BinOp::Mul, comparison, values);
    let result = eval(&func("SUMPRODUCT", vec![mul]), &ctx);
    assert_eq!(result, CellValue::number(40.0));
}

// -----------------------------------------------------------------------
// IFS array broadcasting tests
// -----------------------------------------------------------------------

#[test]
fn test_ifs_array_basic() {
    // IFS({TRUE,FALSE,TRUE}, {10,20,30}, TRUE, {40,50,60})
    // Element 0: cond1[0]=TRUE  → result = 10
    // Element 1: cond1[1]=FALSE → cond2=TRUE → result = 50
    // Element 2: cond1[2]=TRUE  → result = 30
    // → {10, 50, 30}
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond1 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Boolean(true),
            ASTNode::Boolean(false),
            ASTNode::Boolean(true),
        ]],
    };
    let val1 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
            ASTNode::Number(30.0),
        ]],
    };
    let cond2 = ASTNode::Boolean(true);
    let val2 = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(40.0),
            ASTNode::Number(50.0),
            ASTNode::Number(60.0),
        ]],
    };
    let result = eval(&func("IFS", vec![cond1, val1, cond2, val2]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(10.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(50.0));
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::number(30.0));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_ifs_array_all_false() {
    // IFS({FALSE,FALSE}, {10,20}) → {#N/A, #N/A}
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![vec![ASTNode::Boolean(false), ASTNode::Boolean(false)]],
    };
    let val = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(10.0), ASTNode::Number(20.0)]],
    };
    let result = eval(&func("IFS", vec![cond, val]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 2);
            assert_eq!(
                *arr.get(0, 0).unwrap(),
                CellValue::Error(CellError::Na, None)
            );
            assert_eq!(
                *arr.get(0, 1).unwrap(),
                CellValue::Error(CellError::Na, None)
            );
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_ifs_scalar_condition_array_value() {
    // IFS(TRUE, {10,20,30}) → scalar condition TRUE means all elements match
    // → {10, 20, 30}  (value array is returned directly since condition is scalar TRUE)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Boolean(true);
    let val = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
            ASTNode::Number(30.0),
        ]],
    };
    let result = eval(&func("IFS", vec![cond, val]), &ctx);
    // With a scalar TRUE condition and no array conditions, this takes the scalar
    // path and returns the value directly (which is the array).
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(10.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(20.0));
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::number(30.0));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

// -----------------------------------------------------------------------
// XLOOKUP array lookup_value support
// -----------------------------------------------------------------------

#[test]
fn test_xlookup_array_lookup_single_col_return() {
    // XLOOKUP({0,10,20}, A1:A5, B1:B5) should return {1,11,21}
    // test_mirror: col A = [0,10,20,30,40], col B = [1,11,21,31,41]
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let lookup_arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(0.0),
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
        ]],
    };
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

    let node = func("XLOOKUP", vec![lookup_arr, range_a, range_b]);
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0), Some(&CellValue::number(1.0)));
            assert_eq!(arr.get(0, 1), Some(&CellValue::number(11.0)));
            assert_eq!(arr.get(0, 2), Some(&CellValue::number(21.0)));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_xlookup_array_lookup_not_found() {
    // XLOOKUP({0,99,20}, A1:A5, B1:B5) — 99 is not found → {1,#N/A,21}
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let lookup_arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(0.0),
            ASTNode::Number(99.0),
            ASTNode::Number(20.0),
        ]],
    };
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

    let node = func("XLOOKUP", vec![lookup_arr, range_a, range_b]);
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0), Some(&CellValue::number(1.0)));
            assert_eq!(arr.get(0, 1), Some(&CellValue::Error(CellError::Na, None)));
            assert_eq!(arr.get(0, 2), Some(&CellValue::number(21.0)));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_xlookup_array_2d_lookup_rejected() {
    // XLOOKUP({1;2\3;4}, A1:A5, B1:B5) — 2D lookup array → #VALUE!
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let lookup_arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        ],
    };
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

    let node = func("XLOOKUP", vec![lookup_arr, range_a, range_b]);
    let result = eval(&node, &ctx);
    assert_eq!(result, CellValue::Error(CellError::Value, None));
}

#[test]
fn test_xlookup_array_if_not_found_lazy() {
    // XLOOKUP({0,99,20}, A1:A5, B1:B5, "missing") — if_not_found only applied to missing
    // Should return {1,"missing",21}
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let lookup_arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(0.0),
            ASTNode::Number(99.0),
            ASTNode::Number(20.0),
        ]],
    };
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

    let node = func(
        "XLOOKUP",
        vec![
            lookup_arr,
            range_a,
            range_b,
            ASTNode::Text("missing".into()),
        ],
    );
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0), Some(&CellValue::number(1.0)));
            assert_eq!(arr.get(0, 1), Some(&CellValue::Text("missing".into())));
            assert_eq!(arr.get(0, 2), Some(&CellValue::number(21.0)));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

// -----------------------------------------------------------------------
// FILTER with scalar-TRUE * boolean-array include mask
//
// Minimum repro for issue 04 (sort-by-lambda-average): the formula
//   FILTER(dealCol, (dataCol=rowVal)*invMatch*statusMatch, "")
// where invMatch / statusMatch are scalar TRUE (from the `inv="(All)"`
// branch `IF(inv="(All)",TRUE,range=inv)`), must return EXACTLY the rows
// of dealCol where `dataCol=rowVal` is TRUE. Today, the `scalar TRUE *
// bool-array` broadcast retains an extra null row, and FILTER emits one
// extra row downstream — inflating AVERAGE's denominator by 1 and
// producing a ~5.9% relative error in the corpus.
//
// Root cause per investigation: broadcast at
//   compute/core/src/eval/engine/operators.rs (scalar×array path)
// feeding into FILTER at
//   compute/core/crates/compute-functions/src/lookup/dynamic_arrays.rs:185
// -----------------------------------------------------------------------

#[test]
fn test_filter_scalar_true_times_bool_array_preserves_length() {
    // Pattern from the broken formula: FILTER(col, (col=val) * TRUE * TRUE)
    // Data: 5 rows {"x"; "y"; "x"; ""; "x"}, 3 of them equal "x".
    // Expected: FILTER returns exactly 3 rows, all "x".
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    // NOTE: Two independent copies so the AST can pass one to FILTER and one
    // to the equality check without aliasing.
    let data = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("x".into())],
            vec![ASTNode::Text("y".into())],
            vec![ASTNode::Text("x".into())],
            vec![ASTNode::Text("".into())],
            vec![ASTNode::Text("x".into())],
        ],
    };
    let data_for_eq = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Text("x".into())],
            vec![ASTNode::Text("y".into())],
            vec![ASTNode::Text("x".into())],
            vec![ASTNode::Text("".into())],
            vec![ASTNode::Text("x".into())],
        ],
    };

    // (data = "x")              → 5-row boolean array
    let eq = binop(BinOp::Eq, data_for_eq, ASTNode::Text("x".into()));
    // (data = "x") * TRUE       → scalar×array broadcast #1
    let step1 = binop(BinOp::Mul, eq, ASTNode::Boolean(true));
    // (data = "x") * TRUE * TRUE → scalar×array broadcast #2
    let include = binop(BinOp::Mul, step1, ASTNode::Boolean(true));

    let node = func("FILTER", vec![data, include]);
    let result = eval(&node, &ctx);

    match result {
        CellValue::Array(arr) => {
            assert_eq!(
                arr.rows(),
                3,
                "FILTER with (col=val)*TRUE*TRUE mask must return exactly 3 \
                 rows (the 'x' rows at indices 0, 2, 4), NOT an extra phantom \
                 row from the scalar-TRUE × bool-array broadcast. Got array: \
                 {:?}",
                arr
            );
            assert_eq!(arr.cols(), 1);
            assert_eq!(arr.get(0, 0), Some(&CellValue::Text("x".into())));
            assert_eq!(arr.get(1, 0), Some(&CellValue::Text("x".into())));
            assert_eq!(arr.get(2, 0), Some(&CellValue::Text("x".into())));
        }
        other => panic!(
            "Expected 3-row Array from FILTER, got {:?}. Indicates the \
             scalar-TRUE × bool-array broadcast produced an include mask with \
             wrong shape or truthiness (issue 04).",
            other
        ),
    }
}
