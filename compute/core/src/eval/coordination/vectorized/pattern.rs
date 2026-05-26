use ordered_float::OrderedFloat;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;

use cell_types::SheetId;
use compute_parser::{ASTNode, BinOp, CellRefNode, UnaryOp};
use formula_types::CellRef;

use super::types::{ArithOp, CmpOp, MathFn, VecOp};

// ---------------------------------------------------------------------------
// Pattern extraction
// ---------------------------------------------------------------------------

/// Extract a vectorizable pattern from an AST node.
/// Returns None for non-vectorizable formulas (VLOOKUP, SUM over ranges, etc.).
///
/// `cell_sheet` is the sheet of the cell, used for same-sheet validation.
/// `cell_col` is the column of the cell, used to normalize references to offsets.
pub fn extract_vec_pattern(ast: &ASTNode, cell_sheet: SheetId, cell_col: u32) -> Option<VecOp> {
    match ast {
        ASTNode::Number(v) => Some(VecOp::Const(OrderedFloat(*v))),

        ASTNode::CellReference(CellRefNode {
            reference,
            abs_row,
            abs_col: _,
        }) => {
            // Only row-relative, same-sheet positional references are vectorizable
            if *abs_row {
                return None;
            }
            match reference {
                CellRef::Positional { sheet, col, .. } if *sheet == cell_sheet => {
                    Some(VecOp::ColRef(*col as i32 - cell_col as i32))
                }
                _ => None,
            }
        }

        ASTNode::BinaryOp { op, left, right } => {
            match op {
                BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Pow => {
                    let l = extract_vec_pattern(left, cell_sheet, cell_col)?;
                    let r = extract_vec_pattern(right, cell_sheet, cell_col)?;
                    let arith = match op {
                        BinOp::Add => ArithOp::Add,
                        BinOp::Sub => ArithOp::Sub,
                        BinOp::Mul => ArithOp::Mul,
                        BinOp::Div => ArithOp::Div,
                        BinOp::Pow => ArithOp::Pow,
                        _ => unreachable!(),
                    };
                    Some(VecOp::BinOp(Box::new(l), arith, Box::new(r)))
                }
                // Comparison ops are not directly vectorizable as standalone;
                // they are only vectorizable inside an IF condition.
                _ => None,
            }
        }

        ASTNode::UnaryOp { op, operand } => match op {
            UnaryOp::Minus => {
                let inner = extract_vec_pattern(operand, cell_sheet, cell_col)?;
                Some(VecOp::Neg(Box::new(inner)))
            }
            UnaryOp::Plus => extract_vec_pattern(operand, cell_sheet, cell_col),
            UnaryOp::Percent => {
                let inner = extract_vec_pattern(operand, cell_sheet, cell_col)?;
                Some(VecOp::BinOp(
                    Box::new(inner),
                    ArithOp::Div,
                    Box::new(VecOp::Const(OrderedFloat(100.0))),
                ))
            }
            // Implicit intersection (@) is not vectorizable: it collapses a
            // multi-cell range to a single scalar based on the calling cell's
            // position, which the vectorized pattern path does not model.
            UnaryOp::ImplicitIntersection => None,
        },

        ASTNode::Paren(inner) => extract_vec_pattern(inner, cell_sheet, cell_col),

        ASTNode::Function { name, args } => {
            let uname = name.to_uppercase();
            match uname.as_str() {
                "IF" if args.len() == 3 => {
                    // The condition must be a binary comparison
                    if let ASTNode::BinaryOp { op, left, right } = &args[0] {
                        let cmp = match op {
                            BinOp::Eq => CmpOp::Eq,
                            BinOp::Neq => CmpOp::Ne,
                            BinOp::Lt => CmpOp::Lt,
                            BinOp::Gt => CmpOp::Gt,
                            BinOp::Lte => CmpOp::Le,
                            BinOp::Gte => CmpOp::Ge,
                            _ => return None,
                        };
                        let l = extract_vec_pattern(left, cell_sheet, cell_col)?;
                        let r = extract_vec_pattern(right, cell_sheet, cell_col)?;
                        let then_val = extract_vec_pattern(&args[1], cell_sheet, cell_col)?;
                        let else_val = extract_vec_pattern(&args[2], cell_sheet, cell_col)?;
                        Some(VecOp::Cond {
                            left: Box::new(l),
                            cmp,
                            right: Box::new(r),
                            then_val: Box::new(then_val),
                            else_val: Box::new(else_val),
                        })
                    } else {
                        None
                    }
                }
                "ABS" | "SQRT" | "LN" | "EXP" | "FLOOR" | "CEILING" | "INT" if args.len() == 1 => {
                    let mfn = match uname.as_str() {
                        "ABS" => MathFn::Abs,
                        "SQRT" => MathFn::Sqrt,
                        "LN" => MathFn::Ln,
                        "EXP" => MathFn::Exp,
                        "FLOOR" => MathFn::Floor,
                        "CEILING" => MathFn::Ceiling,
                        "INT" => MathFn::Int,
                        _ => unreachable!(),
                    };
                    let inner = extract_vec_pattern(&args[0], cell_sheet, cell_col)?;
                    Some(VecOp::UnaryMath(mfn, Box::new(inner)))
                }
                "ROUND" if args.len() == 2 => {
                    if let ASTNode::Number(digits) = &args[1] {
                        let mfn = if *digits == 0.0 {
                            MathFn::Round0
                        } else if *digits == 2.0 {
                            MathFn::Round2
                        } else {
                            return None;
                        };
                        let inner = extract_vec_pattern(&args[0], cell_sheet, cell_col)?;
                        Some(VecOp::UnaryMath(mfn, Box::new(inner)))
                    } else {
                        None
                    }
                }
                _ => None,
            }
        }

        // Everything else is non-vectorizable
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Input column collection
// ---------------------------------------------------------------------------

/// Collect all input column references from a VecOp pattern.
pub(super) fn collect_input_columns(
    pattern: &VecOp,
    sheet: SheetId,
    out_col: u32,
) -> SmallVec<[(SheetId, u32); 4]> {
    let mut offsets = FxHashSet::default();
    collect_col_offsets(pattern, &mut offsets);
    let mut cols: SmallVec<[(SheetId, u32); 4]> = offsets
        .into_iter()
        .map(|offset| (sheet, (out_col as i32 + offset) as u32))
        .collect();
    cols.sort_by(|a, b| a.0.as_u128().cmp(&b.0.as_u128()).then(a.1.cmp(&b.1)));
    cols.dedup();
    cols
}

pub(super) fn collect_col_offsets(pattern: &VecOp, offsets: &mut FxHashSet<i32>) {
    match pattern {
        VecOp::ColRef(offset) => {
            offsets.insert(*offset);
        }
        VecOp::Const(_) => {}
        VecOp::BinOp(left, _, right) => {
            collect_col_offsets(left, offsets);
            collect_col_offsets(right, offsets);
        }
        VecOp::UnaryMath(_, inner) => {
            collect_col_offsets(inner, offsets);
        }
        VecOp::Cond {
            left,
            right,
            then_val,
            else_val,
            ..
        } => {
            collect_col_offsets(left, offsets);
            collect_col_offsets(right, offsets);
            collect_col_offsets(then_val, offsets);
            collect_col_offsets(else_val, offsets);
        }
        VecOp::Neg(inner) => {
            collect_col_offsets(inner, offsets);
        }
    }
}
