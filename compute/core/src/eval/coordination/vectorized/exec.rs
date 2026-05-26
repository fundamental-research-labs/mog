use cell_types::SheetId;

use value_types::DenseColumn;

use super::types::{ArithOp, CmpOp, MathFn, SharedFormulaGroup, VecOp};

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/// Execute a vectorized group.
/// Returns None if any required input column is not dense.
pub fn execute_group<'a>(
    group: &SharedFormulaGroup,
    get_dense: impl Fn(&SheetId, u32) -> Option<&'a DenseColumn>,
) -> Option<Vec<f64>> {
    // Check all input columns are available
    for &(ref sheet, col) in &group.input_columns {
        get_dense(sheet, col)?;
    }

    let len = (group.end_row - group.start_row) as usize;
    let mut output = vec![0.0f64; len];

    eval_vec_op(
        &group.pattern,
        group.sheet,
        group.col,
        group.start_row,
        &get_dense,
        &mut output,
    );

    Some(output)
}

/// Recursively evaluate a VecOp pattern over a range of rows.
fn eval_vec_op<'a>(
    op: &VecOp,
    sheet: SheetId,
    out_col: u32,
    start_row: u32,
    get_dense: &impl Fn(&SheetId, u32) -> Option<&'a DenseColumn>,
    output: &mut [f64],
) {
    match op {
        VecOp::ColRef(offset) => {
            let src_col = (out_col as i32 + offset) as u32;
            let Some(dense) = get_dense(&sheet, src_col) else {
                output.iter_mut().for_each(|o| *o = f64::NAN);
                return;
            };
            for (i, out) in output.iter_mut().enumerate() {
                let row = start_row as usize + i;
                let adj_row = if row >= dense.start_row() as usize {
                    row - dense.start_row() as usize
                } else {
                    // Row is before the dense column start
                    *out = f64::NAN;
                    continue;
                };
                *out = if adj_row < dense.values().len() {
                    dense.values()[adj_row]
                } else {
                    f64::NAN
                };
            }
        }

        VecOp::Const(v) => {
            let val = v.into_inner();
            output.iter_mut().for_each(|o| *o = val);
        }

        VecOp::BinOp(left, arith_op, right) => {
            let mut left_buf = vec![0.0; output.len()];
            let mut right_buf = vec![0.0; output.len()];
            eval_vec_op(left, sheet, out_col, start_row, get_dense, &mut left_buf);
            eval_vec_op(right, sheet, out_col, start_row, get_dense, &mut right_buf);
            for (i, out) in output.iter_mut().enumerate() {
                *out = apply_arith(*arith_op, left_buf[i], right_buf[i]);
            }
        }

        VecOp::UnaryMath(mfn, inner) => {
            eval_vec_op(inner, sheet, out_col, start_row, get_dense, output);
            for out in output.iter_mut() {
                *out = apply_math(*mfn, *out);
            }
        }

        VecOp::Cond {
            left,
            cmp,
            right,
            then_val,
            else_val,
        } => {
            let len = output.len();
            let mut left_buf = vec![0.0; len];
            let mut right_buf = vec![0.0; len];
            let mut then_buf = vec![0.0; len];
            let mut else_buf = vec![0.0; len];
            eval_vec_op(left, sheet, out_col, start_row, get_dense, &mut left_buf);
            eval_vec_op(right, sheet, out_col, start_row, get_dense, &mut right_buf);
            eval_vec_op(
                then_val,
                sheet,
                out_col,
                start_row,
                get_dense,
                &mut then_buf,
            );
            eval_vec_op(
                else_val,
                sheet,
                out_col,
                start_row,
                get_dense,
                &mut else_buf,
            );
            for i in 0..len {
                output[i] = if apply_cmp(*cmp, left_buf[i], right_buf[i]) {
                    then_buf[i]
                } else {
                    else_buf[i]
                };
            }
        }

        VecOp::Neg(inner) => {
            eval_vec_op(inner, sheet, out_col, start_row, get_dense, output);
            output.iter_mut().for_each(|v| *v = -*v);
        }
    }
}

// ---------------------------------------------------------------------------
// Arithmetic / math / comparison helpers
// ---------------------------------------------------------------------------

#[inline]
fn apply_arith(op: ArithOp, a: f64, b: f64) -> f64 {
    match op {
        ArithOp::Add => a + b,
        ArithOp::Sub => {
            let result = a - b;
            if result != 0.0 {
                use value_types::precision::subtraction_cancels_at_15_digits;
                if subtraction_cancels_at_15_digits(a, b) {
                    return 0.0;
                }
            }
            result
        }
        ArithOp::Mul => a * b,
        ArithOp::Div => a / b,
        ArithOp::Pow => a.powf(b),
    }
}

#[inline]
fn apply_math(mfn: MathFn, v: f64) -> f64 {
    match mfn {
        MathFn::Abs => v.abs(),
        MathFn::Sqrt => v.sqrt(),
        MathFn::Ln => v.ln(),
        MathFn::Exp => v.exp(),
        MathFn::Floor => v.floor(),
        MathFn::Ceiling => v.ceil(),
        MathFn::Int => v.floor(), // Excel INT = floor
        MathFn::Round0 => v.round(),
        MathFn::Round2 => (v * 100.0).round() / 100.0,
    }
}

#[inline]
fn apply_cmp(cmp: CmpOp, a: f64, b: f64) -> bool {
    match cmp {
        CmpOp::Eq => a == b,
        CmpOp::Ne => a != b,
        CmpOp::Lt => a < b,
        CmpOp::Le => a <= b,
        CmpOp::Gt => a > b,
        CmpOp::Ge => a >= b,
    }
}
