use super::*;
use crate::eval::coordination::vectorized::exec::execute_group;
use crate::eval::coordination::vectorized::groups::{detect_groups, order_groups};
use crate::eval::coordination::vectorized::pattern::extract_vec_pattern;
use crate::eval::coordination::vectorized::types::{
    ArithOp, CmpOp, MathFn, SharedFormulaGroup, VecOp,
};

use ordered_float::OrderedFloat;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use cell_types::{CellId, SheetId};
use compute_parser::{ASTNode, AbsFlags, BinOp, CellRefNode, RangeRef, UnaryOp};
use formula_types::CellRef;

use value_types::DenseColumn;

fn sheet() -> SheetId {
    SheetId::from_raw(1)
}

// Helper to create a positional cell reference AST node
fn cell_ref_ast(sheet: SheetId, row: u32, col: u32) -> ASTNode {
    ASTNode::CellReference(CellRefNode {
        reference: CellRef::positional(sheet, row, col),
        abs_row: false,
        abs_col: false,
    })
}

// Helper to create a function AST node
fn func(name: &str, args: Vec<ASTNode>) -> ASTNode {
    ASTNode::Function {
        name: name.to_string().into(),
        args,
    }
}

// Helper dense column: values starting at row 0
fn dense(values: Vec<f64>) -> DenseColumn {
    let numeric_count = values.iter().filter(|v| !v.is_nan()).count();
    DenseColumn::new(values, numeric_count, 0, vec![])
}

// -----------------------------------------------------------------------
// Pattern extraction tests
// -----------------------------------------------------------------------

#[test]
fn test_extract_simple_multiply() {
    // =A1*2 in col B (col=1), sheet S
    let s = sheet();
    let ast = ASTNode::BinaryOp {
        op: BinOp::Mul,
        left: Box::new(cell_ref_ast(s, 0, 0)), // A1
        right: Box::new(ASTNode::Number(2.0)),
    };
    let pattern = extract_vec_pattern(&ast, s, 1);
    assert_eq!(
        pattern,
        Some(VecOp::BinOp(
            Box::new(VecOp::ColRef(-1)),
            ArithOp::Mul,
            Box::new(VecOp::Const(OrderedFloat(2.0))),
        ))
    );
}

#[test]
fn test_extract_two_column_add() {
    // =A1+B1 in col C (col=2)
    let s = sheet();
    let ast = ASTNode::BinaryOp {
        op: BinOp::Add,
        left: Box::new(cell_ref_ast(s, 0, 0)),  // A1
        right: Box::new(cell_ref_ast(s, 0, 1)), // B1
    };
    let pattern = extract_vec_pattern(&ast, s, 2);
    assert_eq!(
        pattern,
        Some(VecOp::BinOp(
            Box::new(VecOp::ColRef(-2)),
            ArithOp::Add,
            Box::new(VecOp::ColRef(-1)),
        ))
    );
}

#[test]
fn test_extract_nested_arithmetic() {
    // =A1/100+B1*0.05 in col C (col=2)
    let s = sheet();
    let ast = ASTNode::BinaryOp {
        op: BinOp::Add,
        left: Box::new(ASTNode::BinaryOp {
            op: BinOp::Div,
            left: Box::new(cell_ref_ast(s, 0, 0)), // A1
            right: Box::new(ASTNode::Number(100.0)),
        }),
        right: Box::new(ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(cell_ref_ast(s, 0, 1)), // B1
            right: Box::new(ASTNode::Number(0.05)),
        }),
    };
    let pattern = extract_vec_pattern(&ast, s, 2);
    assert!(pattern.is_some());
    // Verify structure: BinOp(BinOp(ColRef(-2), Div, Const(100)), Add, BinOp(ColRef(-1), Mul, Const(0.05)))
    match pattern.unwrap() {
        VecOp::BinOp(left, ArithOp::Add, right) => {
            match *left {
                VecOp::BinOp(ref l, ArithOp::Div, ref r) => {
                    assert_eq!(**l, VecOp::ColRef(-2));
                    assert_eq!(**r, VecOp::Const(OrderedFloat(100.0)));
                }
                _ => panic!("expected BinOp Div"),
            }
            match *right {
                VecOp::BinOp(ref l, ArithOp::Mul, ref r) => {
                    assert_eq!(**l, VecOp::ColRef(-1));
                    assert_eq!(**r, VecOp::Const(OrderedFloat(0.05)));
                }
                _ => panic!("expected BinOp Mul"),
            }
        }
        _ => panic!("expected BinOp Add"),
    }
}

#[test]
fn test_extract_if_condition() {
    // =IF(A1>0,A1,0) in col B (col=1)
    let s = sheet();
    let ast = func(
        "IF",
        vec![
            ASTNode::BinaryOp {
                op: BinOp::Gt,
                left: Box::new(cell_ref_ast(s, 0, 0)),
                right: Box::new(ASTNode::Number(0.0)),
            },
            cell_ref_ast(s, 0, 0),
            ASTNode::Number(0.0),
        ],
    );
    let pattern = extract_vec_pattern(&ast, s, 1);
    assert_eq!(
        pattern,
        Some(VecOp::Cond {
            left: Box::new(VecOp::ColRef(-1)),
            cmp: CmpOp::Gt,
            right: Box::new(VecOp::Const(OrderedFloat(0.0))),
            then_val: Box::new(VecOp::ColRef(-1)),
            else_val: Box::new(VecOp::Const(OrderedFloat(0.0))),
        })
    );
}

#[test]
fn test_extract_unary_abs() {
    // =ABS(A1-B1) in col C (col=2)
    let s = sheet();
    let ast = func(
        "ABS",
        vec![ASTNode::BinaryOp {
            op: BinOp::Sub,
            left: Box::new(cell_ref_ast(s, 0, 0)),
            right: Box::new(cell_ref_ast(s, 0, 1)),
        }],
    );
    let pattern = extract_vec_pattern(&ast, s, 2);
    assert_eq!(
        pattern,
        Some(VecOp::UnaryMath(
            MathFn::Abs,
            Box::new(VecOp::BinOp(
                Box::new(VecOp::ColRef(-2)),
                ArithOp::Sub,
                Box::new(VecOp::ColRef(-1)),
            ))
        ))
    );
}

#[test]
fn test_extract_negation() {
    // =-A1 in col B (col=1)
    let s = sheet();
    let ast = ASTNode::UnaryOp {
        op: UnaryOp::Minus,
        operand: Box::new(cell_ref_ast(s, 0, 0)),
    };
    let pattern = extract_vec_pattern(&ast, s, 1);
    assert_eq!(pattern, Some(VecOp::Neg(Box::new(VecOp::ColRef(-1)))));
}

#[test]
fn test_extract_round() {
    // =ROUND(A1,2) in col B (col=1)
    let s = sheet();
    let ast = func("ROUND", vec![cell_ref_ast(s, 0, 0), ASTNode::Number(2.0)]);
    let pattern = extract_vec_pattern(&ast, s, 1);
    assert_eq!(
        pattern,
        Some(VecOp::UnaryMath(
            MathFn::Round2,
            Box::new(VecOp::ColRef(-1))
        ))
    );
}

#[test]
fn test_extract_vlookup_returns_none() {
    let s = sheet();
    let ast = func(
        "VLOOKUP",
        vec![
            cell_ref_ast(s, 0, 0),
            ASTNode::Range(RangeRef {
                start: CellRef::positional(s, 0, 1),
                end: CellRef::positional(s, 9, 3),
                abs_start: AbsFlags::default(),
                abs_end: AbsFlags::default(),
                range_type: formula_types::RangeType::CellRange,
            }),
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(extract_vec_pattern(&ast, s, 0), None);
}

#[test]
fn test_extract_sum_returns_none() {
    let s = sheet();
    let ast = func(
        "SUM",
        vec![ASTNode::Range(RangeRef {
            start: CellRef::positional(s, 0, 0),
            end: CellRef::positional(s, 9, 0),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: formula_types::RangeType::CellRange,
        })],
    );
    assert_eq!(extract_vec_pattern(&ast, s, 1), None);
}

#[test]
fn test_extract_indirect_returns_none() {
    let ast = func("INDIRECT", vec![ASTNode::Text("A1".to_string())]);
    assert_eq!(extract_vec_pattern(&ast, sheet(), 0), None);
}

#[test]
fn test_extract_volatile_returns_none() {
    let ast = func("RAND", vec![]);
    assert_eq!(extract_vec_pattern(&ast, sheet(), 0), None);
}

#[test]
fn test_extract_absolute_row_none() {
    // =$A$5*2 — abs_row=true → None
    let s = sheet();
    let ast = ASTNode::BinaryOp {
        op: BinOp::Mul,
        left: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::positional(s, 4, 0),
            abs_row: true,
            abs_col: true,
        })),
        right: Box::new(ASTNode::Number(2.0)),
    };
    assert_eq!(extract_vec_pattern(&ast, s, 1), None);
}

// -----------------------------------------------------------------------
// Group detection tests
// -----------------------------------------------------------------------

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

#[test]
fn test_detect_contiguous_group() {
    let s = sheet();
    let count = 1000usize;
    let mut dirty = FxHashSet::default();
    let mut ast_cache = FxHashMap::default();
    let mut pos_map = FxHashMap::default();

    // 1000 cells in col B (col=1), all with pattern =A_*2
    for i in 0..count {
        let cid = make_cell_id(i as u128);
        dirty.insert(cid);
        let ast = ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(cell_ref_ast(s, i as u32, 0)),
            right: Box::new(ASTNode::Number(2.0)),
        };
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i as u32, 1u32)); // col B
    }

    let groups = detect_groups(
        &dirty,
        |cid| ast_cache.get(cid),
        |cid| pos_map.get(cid).copied(),
        256,
    );
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].cell_ids.len(), 1000);
    assert_eq!(groups[0].start_row, 0);
    assert_eq!(groups[0].end_row, 1000);
    assert_eq!(groups[0].col, 1);
}

#[test]
fn test_detect_gap_splits_groups() {
    let s = sheet();
    let mut dirty = FxHashSet::default();
    let mut ast_cache = FxHashMap::default();
    let mut pos_map = FxHashMap::default();

    // rows 0-499 and 501-1000 (gap at row 500)
    for i in 0..500u32 {
        let cid = make_cell_id(i as u128);
        dirty.insert(cid);
        let ast = ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(cell_ref_ast(s, i, 0)),
            right: Box::new(ASTNode::Number(2.0)),
        };
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i, 1u32));
    }
    for i in 501..1001u32 {
        let cid = make_cell_id(i as u128);
        dirty.insert(cid);
        let ast = ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(cell_ref_ast(s, i, 0)),
            right: Box::new(ASTNode::Number(2.0)),
        };
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i, 1u32));
    }

    let groups = detect_groups(
        &dirty,
        |cid| ast_cache.get(cid),
        |cid| pos_map.get(cid).copied(),
        256,
    );
    assert_eq!(groups.len(), 2);
}

#[test]
fn test_detect_different_patterns() {
    let s = sheet();
    let mut dirty = FxHashSet::default();
    let mut ast_cache = FxHashMap::default();
    let mut pos_map = FxHashMap::default();

    // Col B: =A*2 (500 cells)
    for i in 0..500u32 {
        let cid = make_cell_id(i as u128);
        dirty.insert(cid);
        let ast = ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(cell_ref_ast(s, i, 0)),
            right: Box::new(ASTNode::Number(2.0)),
        };
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i, 1u32));
    }

    // Col C: =A+1 (500 cells)
    for i in 0..500u32 {
        let cid = make_cell_id(1000 + i as u128);
        dirty.insert(cid);
        let ast = ASTNode::BinaryOp {
            op: BinOp::Add,
            left: Box::new(cell_ref_ast(s, i, 0)),
            right: Box::new(ASTNode::Number(1.0)),
        };
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i, 2u32));
    }

    let groups = detect_groups(
        &dirty,
        |cid| ast_cache.get(cid),
        |cid| pos_map.get(cid).copied(),
        256,
    );
    assert_eq!(groups.len(), 2);
}

#[test]
fn test_detect_below_threshold() {
    let s = sheet();
    let mut dirty = FxHashSet::default();
    let mut ast_cache = FxHashMap::default();
    let mut pos_map = FxHashMap::default();

    for i in 0..5u32 {
        let cid = make_cell_id(i as u128);
        dirty.insert(cid);
        let ast = ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(cell_ref_ast(s, i, 0)),
            right: Box::new(ASTNode::Number(2.0)),
        };
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i, 1u32));
    }

    let groups = detect_groups(
        &dirty,
        |cid| ast_cache.get(cid),
        |cid| pos_map.get(cid).copied(),
        256,
    );
    assert!(groups.is_empty());
}

#[test]
fn test_detect_mixed_vectorizable() {
    let s = sheet();
    let mut dirty = FxHashSet::default();
    let mut ast_cache = FxHashMap::default();
    let mut pos_map = FxHashMap::default();

    // 300 vectorizable cells
    for i in 0..300u32 {
        let cid = make_cell_id(i as u128);
        dirty.insert(cid);
        let ast = ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(cell_ref_ast(s, i, 0)),
            right: Box::new(ASTNode::Number(2.0)),
        };
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i, 1u32));
    }

    // 50 non-vectorizable cells (SUM range)
    for i in 300..350u32 {
        let cid = make_cell_id(i as u128);
        dirty.insert(cid);
        let ast = func(
            "SUM",
            vec![ASTNode::Range(RangeRef {
                start: CellRef::positional(s, 0, 0),
                end: CellRef::positional(s, 9, 0),
                abs_start: AbsFlags::default(),
                abs_end: AbsFlags::default(),
                range_type: formula_types::RangeType::CellRange,
            })],
        );
        ast_cache.insert(cid, ast);
        pos_map.insert(cid, (s, i, 1u32));
    }

    let groups = detect_groups(
        &dirty,
        |cid| ast_cache.get(cid),
        |cid| pos_map.get(cid).copied(),
        256,
    );
    // Only the 300 vectorizable cells form a group
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].cell_ids.len(), 300);
}

// -----------------------------------------------------------------------
// Group ordering tests
// -----------------------------------------------------------------------

#[test]
fn test_order_independent_groups() {
    // B=A*2, D=C+1 — independent
    let s = sheet();
    let groups = vec![
        SharedFormulaGroup {
            sheet: s,
            col: 1, // B
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-1)),
                ArithOp::Mul,
                Box::new(VecOp::Const(OrderedFloat(2.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 0)]), // A
        },
        SharedFormulaGroup {
            sheet: s,
            col: 3, // D
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-1)),
                ArithOp::Add,
                Box::new(VecOp::Const(OrderedFloat(1.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 2)]), // C
        },
    ];
    let order = order_groups(&groups);
    assert_eq!(order.len(), 2);
    // Both should be present
    assert!(order.contains(&0));
    assert!(order.contains(&1));
}

#[test]
fn test_order_chain_dependency() {
    // B=A*2 (group0), C=B+1 (group1) → [0, 1] order
    let s = sheet();
    let groups = vec![
        SharedFormulaGroup {
            sheet: s,
            col: 1, // B
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-1)),
                ArithOp::Mul,
                Box::new(VecOp::Const(OrderedFloat(2.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 0)]), // A
        },
        SharedFormulaGroup {
            sheet: s,
            col: 2, // C
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-1)),
                ArithOp::Add,
                Box::new(VecOp::Const(OrderedFloat(1.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 1)]), // B
        },
    ];
    let order = order_groups(&groups);
    assert_eq!(order, vec![0, 1]);
}

#[test]
fn test_order_diamond_dependency() {
    // C=A+1 (group0), D=A*2 (group1), E=C+D (group2) → C,D before E
    let s = sheet();
    let groups = vec![
        SharedFormulaGroup {
            sheet: s,
            col: 2, // C
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-2)),
                ArithOp::Add,
                Box::new(VecOp::Const(OrderedFloat(1.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 0)]), // A
        },
        SharedFormulaGroup {
            sheet: s,
            col: 3, // D
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-3)),
                ArithOp::Mul,
                Box::new(VecOp::Const(OrderedFloat(2.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 0)]), // A
        },
        SharedFormulaGroup {
            sheet: s,
            col: 4, // E
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-2)),
                ArithOp::Add,
                Box::new(VecOp::ColRef(-1)),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 2), (s, 3)]), // C, D
        },
    ];
    let order = order_groups(&groups);
    assert_eq!(order.len(), 3);
    // group2 (E) must come after group0 (C) and group1 (D)
    let pos_0 = order.iter().position(|&x| x == 0).unwrap();
    let pos_1 = order.iter().position(|&x| x == 1).unwrap();
    let pos_2 = order.iter().position(|&x| x == 2).unwrap();
    assert!(pos_0 < pos_2);
    assert!(pos_1 < pos_2);
}

#[test]
fn test_order_cycle_excluded() {
    // B=C*2, C=B+1 → cycle, both excluded
    let s = sheet();
    let groups = vec![
        SharedFormulaGroup {
            sheet: s,
            col: 1, // B
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(1)),
                ArithOp::Mul,
                Box::new(VecOp::Const(OrderedFloat(2.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 2)]), // C
        },
        SharedFormulaGroup {
            sheet: s,
            col: 2, // C
            start_row: 0,
            end_row: 100,
            pattern: VecOp::BinOp(
                Box::new(VecOp::ColRef(-1)),
                ArithOp::Add,
                Box::new(VecOp::Const(OrderedFloat(1.0))),
            ),
            cell_ids: vec![],
            input_columns: SmallVec::from_vec(vec![(s, 1)]), // B
        },
    ];
    let order = order_groups(&groups);
    assert!(order.is_empty());
}

// -----------------------------------------------------------------------
// Execution tests
// -----------------------------------------------------------------------

#[test]
fn test_execute_multiply() {
    // [1,2,3,4] * 2 → [2,4,6,8]
    let s = sheet();
    let col_a = dense(vec![1.0, 2.0, 3.0, 4.0]);
    let group = SharedFormulaGroup {
        sheet: s,
        col: 1,
        start_row: 0,
        end_row: 4,
        pattern: VecOp::BinOp(
            Box::new(VecOp::ColRef(-1)),
            ArithOp::Mul,
            Box::new(VecOp::Const(OrderedFloat(2.0))),
        ),
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0)]),
    };
    let result = execute_group(&group, |sheet_id, col| {
        if *sheet_id == s && col == 0 {
            Some(&col_a)
        } else {
            None
        }
    });
    assert_eq!(result, Some(vec![2.0, 4.0, 6.0, 8.0]));
}

#[test]
fn test_execute_add_two_columns() {
    // [1,2,3] + [10,20,30] → [11,22,33]
    let s = sheet();
    let col_a = dense(vec![1.0, 2.0, 3.0]);
    let col_b = dense(vec![10.0, 20.0, 30.0]);
    let group = SharedFormulaGroup {
        sheet: s,
        col: 2,
        start_row: 0,
        end_row: 3,
        pattern: VecOp::BinOp(
            Box::new(VecOp::ColRef(-2)),
            ArithOp::Add,
            Box::new(VecOp::ColRef(-1)),
        ),
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0), (s, 1)]),
    };
    let result = execute_group(&group, |sheet_id, col| {
        if *sheet_id == s && col == 0 {
            Some(&col_a)
        } else if *sheet_id == s && col == 1 {
            Some(&col_b)
        } else {
            None
        }
    });
    assert_eq!(result, Some(vec![11.0, 22.0, 33.0]));
}

#[test]
fn test_execute_if_condition() {
    // IF([5,-3,0]>0, [5,-3,0], 0) → [5,0,0]
    let s = sheet();
    let col_a = dense(vec![5.0, -3.0, 0.0]);
    let group = SharedFormulaGroup {
        sheet: s,
        col: 1,
        start_row: 0,
        end_row: 3,
        pattern: VecOp::Cond {
            left: Box::new(VecOp::ColRef(-1)),
            cmp: CmpOp::Gt,
            right: Box::new(VecOp::Const(OrderedFloat(0.0))),
            then_val: Box::new(VecOp::ColRef(-1)),
            else_val: Box::new(VecOp::Const(OrderedFloat(0.0))),
        },
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0)]),
    };
    let result = execute_group(&group, |sheet_id, col| {
        if *sheet_id == s && col == 0 {
            Some(&col_a)
        } else {
            None
        }
    });
    assert_eq!(result, Some(vec![5.0, 0.0, 0.0]));
}

#[test]
fn test_execute_abs_difference() {
    // ABS([10,5,8] - [7,9,3]) → [3,4,5]
    let s = sheet();
    let col_a = dense(vec![10.0, 5.0, 8.0]);
    let col_b = dense(vec![7.0, 9.0, 3.0]);
    let group = SharedFormulaGroup {
        sheet: s,
        col: 2,
        start_row: 0,
        end_row: 3,
        pattern: VecOp::UnaryMath(
            MathFn::Abs,
            Box::new(VecOp::BinOp(
                Box::new(VecOp::ColRef(-2)),
                ArithOp::Sub,
                Box::new(VecOp::ColRef(-1)),
            )),
        ),
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0), (s, 1)]),
    };
    let result = execute_group(&group, |sheet_id, col| {
        if *sheet_id == s && col == 0 {
            Some(&col_a)
        } else if *sheet_id == s && col == 1 {
            Some(&col_b)
        } else {
            None
        }
    });
    assert_eq!(result, Some(vec![3.0, 4.0, 5.0]));
}

#[test]
fn test_execute_nested_expression() {
    // [1,2,3]/100 + [4,5,6]*0.05 → [0.21, 0.27, 0.33]
    let s = sheet();
    let col_a = dense(vec![1.0, 2.0, 3.0]);
    let col_b = dense(vec![4.0, 5.0, 6.0]);
    let group = SharedFormulaGroup {
        sheet: s,
        col: 2,
        start_row: 0,
        end_row: 3,
        pattern: VecOp::BinOp(
            Box::new(VecOp::BinOp(
                Box::new(VecOp::ColRef(-2)),
                ArithOp::Div,
                Box::new(VecOp::Const(OrderedFloat(100.0))),
            )),
            ArithOp::Add,
            Box::new(VecOp::BinOp(
                Box::new(VecOp::ColRef(-1)),
                ArithOp::Mul,
                Box::new(VecOp::Const(OrderedFloat(0.05))),
            )),
        ),
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0), (s, 1)]),
    };
    let result = execute_group(&group, |sheet_id, col| {
        if *sheet_id == s && col == 0 {
            Some(&col_a)
        } else if *sheet_id == s && col == 1 {
            Some(&col_b)
        } else {
            None
        }
    })
    .unwrap();

    // Check with floating point tolerance
    assert!((result[0] - 0.21).abs() < 1e-10);
    assert!((result[1] - 0.27).abs() < 1e-10);
    assert!((result[2] - 0.33).abs() < 1e-10);
}

#[test]
fn test_execute_nan_propagation() {
    // NaN in input → NaN in output
    let s = sheet();
    let col_a = dense(vec![1.0, f64::NAN, 3.0]);
    let group = SharedFormulaGroup {
        sheet: s,
        col: 1,
        start_row: 0,
        end_row: 3,
        pattern: VecOp::BinOp(
            Box::new(VecOp::ColRef(-1)),
            ArithOp::Mul,
            Box::new(VecOp::Const(OrderedFloat(2.0))),
        ),
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0)]),
    };
    let result = execute_group(&group, |sheet_id, col| {
        if *sheet_id == s && col == 0 {
            Some(&col_a)
        } else {
            None
        }
    })
    .unwrap();
    assert_eq!(result[0], 2.0);
    assert!(result[1].is_nan());
    assert_eq!(result[2], 6.0);
}

#[test]
fn test_execute_div_by_zero() {
    // x / 0.0 → f64::INFINITY (IEEE 754)
    let s = sheet();
    let col_a = dense(vec![1.0, -2.0]);
    let group = SharedFormulaGroup {
        sheet: s,
        col: 1,
        start_row: 0,
        end_row: 2,
        pattern: VecOp::BinOp(
            Box::new(VecOp::ColRef(-1)),
            ArithOp::Div,
            Box::new(VecOp::Const(OrderedFloat(0.0))),
        ),
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0)]),
    };
    let result = execute_group(&group, |sheet_id, col| {
        if *sheet_id == s && col == 0 {
            Some(&col_a)
        } else {
            None
        }
    })
    .unwrap();
    assert_eq!(result[0], f64::INFINITY);
    assert_eq!(result[1], f64::NEG_INFINITY);
}

#[test]
fn test_execute_missing_input_none() {
    // Input column not available → returns None
    let s = sheet();
    let group = SharedFormulaGroup {
        sheet: s,
        col: 1,
        start_row: 0,
        end_row: 3,
        pattern: VecOp::BinOp(
            Box::new(VecOp::ColRef(-1)),
            ArithOp::Mul,
            Box::new(VecOp::Const(OrderedFloat(2.0))),
        ),
        cell_ids: vec![],
        input_columns: SmallVec::from_vec(vec![(s, 0)]),
    };
    let result = execute_group(&group, |_, _| None);
    assert!(result.is_none());
}

#[test]
fn test_execute_empty_group() {
    // 0 rows → Some(empty vec)
    let s = sheet();
    let group = SharedFormulaGroup {
        sheet: s,
        col: 1,
        start_row: 5,
        end_row: 5, // 0 rows
        pattern: VecOp::Const(OrderedFloat(42.0)),
        cell_ids: vec![],
        input_columns: SmallVec::new(),
    };
    let result = execute_group(&group, |_, _| None);
    assert_eq!(result, Some(vec![]));
}
