//! SUMPRODUCT tests and IF omitted-argument handling.

use super::*;

// -----------------------------------------------------------------------
// SUMPRODUCT tests
// -----------------------------------------------------------------------

#[test]
fn test_sumproduct_basic_mul_chain() {
    // SUMPRODUCT({1;2;3} * {4;5;6}) = 1*4 + 2*5 + 3*6 = 32
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr1 = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0)],
        ],
    };
    let arr2 = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(4.0)],
            vec![ASTNode::Number(5.0)],
            vec![ASTNode::Number(6.0)],
        ],
    };
    let mul = binop(BinOp::Mul, arr1, arr2);
    let result = eval(&func("SUMPRODUCT", vec![mul]), &ctx);
    assert_eq!(result, CellValue::number(32.0));
}

#[test]
fn test_sumproduct_if_scalar_branches() {
    // SUMPRODUCT(IF({TRUE;FALSE;TRUE}, 10, 0)) = 10 + 0 + 10 = 20
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Boolean(true)],
            vec![ASTNode::Boolean(false)],
            vec![ASTNode::Boolean(true)],
        ],
    };
    let if_node = func(
        "IF",
        vec![cond, ASTNode::Number(10.0), ASTNode::Number(0.0)],
    );
    let result = eval(&func("SUMPRODUCT", vec![if_node]), &ctx);
    assert_eq!(result, CellValue::number(20.0));
}

#[test]
fn test_sumproduct_if_array_branches() {
    // SUMPRODUCT(IF({TRUE;FALSE;TRUE}, {1;2;3}, {10;20;30})) = 1 + 20 + 3 = 24
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Boolean(true)],
            vec![ASTNode::Boolean(false)],
            vec![ASTNode::Boolean(true)],
        ],
    };
    let val_true = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0)],
        ],
    };
    let val_false = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(10.0)],
            vec![ASTNode::Number(20.0)],
            vec![ASTNode::Number(30.0)],
        ],
    };
    let if_node = func("IF", vec![cond, val_true, val_false]);
    let result = eval(&func("SUMPRODUCT", vec![if_node]), &ctx);
    assert_eq!(result, CellValue::number(24.0));
}

#[test]
fn test_sumproduct_if_mixed_scalar_array() {
    // SUMPRODUCT(IF({TRUE;FALSE;TRUE}, {1;2;3}, 0)) = 1 + 0 + 3 = 4
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Boolean(true)],
            vec![ASTNode::Boolean(false)],
            vec![ASTNode::Boolean(true)],
        ],
    };
    let val_true = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0)],
        ],
    };
    let if_node = func("IF", vec![cond, val_true, ASTNode::Number(0.0)]);
    let result = eval(&func("SUMPRODUCT", vec![if_node]), &ctx);
    assert_eq!(result, CellValue::number(4.0));
}

#[test]
fn test_sumproduct_if_omitted_false_branch() {
    // SUMPRODUCT(IF({TRUE;FALSE;TRUE}, 5)) = 5 + 0 + 5 = 10
    // When false branch is omitted, IF returns FALSE which coerces to 0
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Boolean(true)],
            vec![ASTNode::Boolean(false)],
            vec![ASTNode::Boolean(true)],
        ],
    };
    let if_node = func("IF", vec![cond, ASTNode::Number(5.0)]);
    let result = eval(&func("SUMPRODUCT", vec![if_node]), &ctx);
    assert_eq!(result, CellValue::number(10.0));
}

#[test]
fn test_sumproduct_if_numeric_condition() {
    // SUMPRODUCT(IF({1;0;1}, 10, 0)) = 10 + 0 + 10 = 20
    // Numeric condition: 0=false, nonzero=true
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0)],
            vec![ASTNode::Number(0.0)],
            vec![ASTNode::Number(1.0)],
        ],
    };
    let if_node = func(
        "IF",
        vec![cond, ASTNode::Number(10.0), ASTNode::Number(0.0)],
    );
    let result = eval(&func("SUMPRODUCT", vec![if_node]), &ctx);
    assert_eq!(result, CellValue::number(20.0));
}

// -----------------------------------------------------------------------
// IF omitted-argument handling (Excel returns 0 for omitted branches)
// -----------------------------------------------------------------------

#[test]
fn test_if_true_omitted_true_branch() {
    // =IF(TRUE,,5) → 0  (omitted true-branch returns 0)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![
            ASTNode::Boolean(true),
            ASTNode::Omitted,
            ASTNode::Number(5.0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn test_if_false_omitted_true_branch() {
    // =IF(FALSE,,5) → 5  (false-branch is 5, omitted true-branch not evaluated)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![
            ASTNode::Boolean(false),
            ASTNode::Omitted,
            ASTNode::Number(5.0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(5.0));
}

#[test]
fn test_if_true_omitted_false_branch() {
    // =IF(TRUE,5,) → 5  (true-branch is 5, omitted false-branch not evaluated)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![
            ASTNode::Boolean(true),
            ASTNode::Number(5.0),
            ASTNode::Omitted,
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(5.0));
}

#[test]
fn test_if_false_omitted_false_branch() {
    // =IF(FALSE,5,) → 0  (omitted false-branch returns 0)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![
            ASTNode::Boolean(false),
            ASTNode::Number(5.0),
            ASTNode::Omitted,
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn test_if_true_both_omitted() {
    // =IF(TRUE,,) → 0  (both branches omitted, true-branch returns 0)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![ASTNode::Boolean(true), ASTNode::Omitted, ASTNode::Omitted],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn test_if_false_both_omitted() {
    // =IF(FALSE,,) → 0  (both branches omitted, false-branch returns 0)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![ASTNode::Boolean(false), ASTNode::Omitted, ASTNode::Omitted],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn test_if_array_omitted_true_branch() {
    // =IF({TRUE;FALSE},,5) → {0;5}  (array condition with omitted true-branch)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![vec![ASTNode::Boolean(true)], vec![ASTNode::Boolean(false)]],
    };
    let node = func("IF", vec![cond, ASTNode::Omitted, ASTNode::Number(5.0)]);
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.get(0, 0), Some(&CellValue::number(0.0)));
            assert_eq!(arr.get(1, 0), Some(&CellValue::number(5.0)));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_if_array_omitted_false_branch() {
    // =IF({TRUE;FALSE},5,) → {5;0}  (array condition with omitted false-branch)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![vec![ASTNode::Boolean(true)], vec![ASTNode::Boolean(false)]],
    };
    let node = func("IF", vec![cond, ASTNode::Number(5.0), ASTNode::Omitted]);
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.get(0, 0), Some(&CellValue::number(5.0)));
            assert_eq!(arr.get(1, 0), Some(&CellValue::number(0.0)));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_if_array_both_omitted() {
    // =IF({TRUE;FALSE},,) → {0;0}  (array condition with both branches omitted)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cond = ASTNode::Array {
        rows: vec![vec![ASTNode::Boolean(true)], vec![ASTNode::Boolean(false)]],
    };
    let node = func("IF", vec![cond, ASTNode::Omitted, ASTNode::Omitted]);
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.get(0, 0), Some(&CellValue::number(0.0)));
            assert_eq!(arr.get(1, 0), Some(&CellValue::number(0.0)));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}
