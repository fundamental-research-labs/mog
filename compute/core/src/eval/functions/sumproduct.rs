//! Vectorized SUMPRODUCT — evaluates array arguments directly without
//! redundant flattening or intermediate broadcasting.
//!
//! Three paths:
//! 1. **Fused single-arg Mul chain** — `SUMPRODUCT((A:A="x")*(B:B>0)*C:C)`:
//!    the single AST argument is a chain of `Mul` nodes. We decompose the tree,
//!    evaluate each leaf independently, then do a single-pass multiply-accumulate
//!    without allocating any intermediate broadcast arrays. ~15-50x faster.
//! 2. **Fused SUMPRODUCT(IF(...))** — `SUMPRODUCT(IF(cond, val_t, val_f))`:
//!    evaluates condition, true-value, and false-value independently, then does
//!    a single-pass conditional sum without an intermediate array from IF.
//! 3. **Standard multi-arg** — `SUMPRODUCT(A1:A10, B1:B10)`: evaluate each
//!    argument, convert to 2D f64 grids, multiply-accumulate with broadcasting.

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;
use compute_parser::{ASTNode, BinOp};
use value_types::{CellError, CellValue, ComputeError, KahanSum};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    /// SUMPRODUCT special dispatch.
    pub(in crate::eval) async fn eval_sumproduct(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Fast path: single-arg with Mul chain → fused multiply-accumulate
        if args.len() == 1
            && let Some(result) = self.try_fused_single_arg(&args[0]).await?
        {
            return Ok(result);
        }

        // Standard multi-arg path
        self.eval_sumproduct_standard(args).await
    }

    /// Standard multi-arg SUMPRODUCT: evaluate each arg, convert to flat grids,
    /// multiply-accumulate with broadcasting.
    async fn eval_sumproduct_standard(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        let mut grids: Vec<FlatGrid> = Vec::with_capacity(args.len());
        for arg in args {
            let val = self.eval_node_cv(arg).await?;
            match FlatGrid::from_cell_value(&val) {
                Ok(grid) => grids.push(grid),
                Err(e) => return Ok(CellValue::Error(e, None)),
            }
        }

        if grids.is_empty() {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        multiply_accumulate_flat(&grids)
    }

    /// Fused path for `SUMPRODUCT(expr1 * expr2 * expr3)`.
    ///
    /// Detects when the single argument is a tree of `BinOp::Mul` nodes,
    /// extracts the leaf sub-expressions, evaluates each independently,
    /// and does a single-pass multiply-accumulate — no intermediate arrays.
    ///
    /// Also detects `SUMPRODUCT(IF(cond, val_t, val_f))` and fuses the
    /// conditional sum to avoid the intermediate array allocation from IF.
    async fn try_fused_single_arg(
        &mut self,
        arg: &ASTNode,
    ) -> Result<Option<CellValue>, ComputeError> {
        // Path 1: Mul chain → fused multiply-accumulate
        if let Some(leaves) = extract_mul_leaves(arg)
            && leaves.len() >= 2
        {
            let mut grids: Vec<FlatGrid> = Vec::with_capacity(leaves.len());
            for leaf in &leaves {
                let val = self.eval_node_cv(leaf).await?;
                // Use strict coercion: text → #VALUE! (matching the * operator).
                // The fused path bypasses the * operator's type checking, so we
                // must replicate it here. In Excel, SUMPRODUCT(A*B) where B
                // contains text returns #VALUE!, unlike SUMPRODUCT(A, B) which
                // treats text as 0.
                match FlatGrid::from_cell_value_strict(&val) {
                    Ok(grid) => grids.push(grid),
                    Err(e) => return Ok(Some(CellValue::Error(e, None))),
                }
            }

            return match multiply_accumulate_flat(&grids) {
                Ok(result) => Ok(Some(result)),
                Err(e) => Err(e),
            };
        }

        // Path 2: SUMPRODUCT(IF(cond, val_true, val_false)) → fused conditional sum
        let inner = unwrap_parens(arg);
        if let ASTNode::Function { name, args } = inner
            && name.eq_ignore_ascii_case("IF")
            && args.len() >= 2
        {
            return self.try_fused_sumproduct_if(args).await;
        }

        Ok(None) // Not a recognized pattern, fall through to standard path
    }

    /// Fused `SUMPRODUCT(IF(cond, val_true [, val_false]))`.
    ///
    /// Evaluates condition and value branches independently, then sums
    /// with conditional selection in a single pass — no intermediate IF array.
    ///
    /// Returns `Ok(None)` if the pattern doesn't match expectations,
    /// falling through to the standard path.
    async fn try_fused_sumproduct_if(
        &mut self,
        if_args: &[ASTNode],
    ) -> Result<Option<CellValue>, ComputeError> {
        // Evaluate condition
        let cond_val = self.eval_node_cv(&if_args[0]).await?;
        let cond_grid = match to_bool_2d(&cond_val) {
            Some(g) => g,
            None => return Ok(None), // condition isn't a bool/numeric array, fall through
        };

        let rows = cond_grid.len();
        let cols = cond_grid.first().map_or(1, |r| r.len());

        // Evaluate true branch
        let val_true = self.eval_node_cv(&if_args[1]).await?;

        // Evaluate false branch (defaults to FALSE=0 if omitted, matching IF behavior)
        let val_false = if if_args.len() > 2 {
            self.eval_node_cv(&if_args[2]).await?
        } else {
            CellValue::Boolean(false)
        };

        // Conditional element-wise sum: select from the branch chosen by
        // the condition, then coerce only the selected value to f64.
        // This avoids propagating errors from positions where the OTHER
        // branch would be used — matching Excel's lazy-IF-in-array behavior.
        // e.g. SUMPRODUCT(IF({1,0},{1,1}/{1,0},{0,0})) must return 1, not #DIV/0!
        let mut sum = KahanSum::new();
        for r in 0..rows {
            for c in 0..cols {
                let b = cond_grid
                    .get(r)
                    .and_then(|row| row.get(c))
                    .copied()
                    .unwrap_or(false);
                let source = if b { &val_true } else { &val_false };

                let elem = match source {
                    CellValue::Array(arr) => {
                        let ri = if arr.rows() == 1 { 0 } else { r };
                        let ci = if arr.cols() == 1 { 0 } else { c };
                        arr.get(ri, ci).cloned().unwrap_or(CellValue::Null)
                    }
                    other => other.clone(),
                };

                match coerce_for_sumproduct(&elem) {
                    Ok(v) => sum.add(v),
                    Err(e) => return Ok(Some(CellValue::Error(e, None))),
                }
            }
        }
        Ok(Some(CellValue::number(sum.total())))
    }
}

/// Decompose a `Mul` tree into its non-Mul leaf expressions.
///
/// `(A = "x") * (B > 0) * C` → `[A = "x", B > 0, C]`
///
/// Returns `None` if the root is not a `BinOp::Mul`.
fn extract_mul_leaves(node: &ASTNode) -> Option<Vec<&ASTNode>> {
    // Unwrap parens transparently
    let inner = unwrap_parens(node);
    match inner {
        ASTNode::BinaryOp {
            op: BinOp::Mul,
            left,
            right,
        } => {
            let mut leaves = Vec::new();
            collect_mul_children(left, &mut leaves);
            collect_mul_children(right, &mut leaves);
            Some(leaves)
        }
        _ => None,
    }
}

fn collect_mul_children<'a>(node: &'a ASTNode, out: &mut Vec<&'a ASTNode>) {
    let inner = unwrap_parens(node);
    match inner {
        ASTNode::BinaryOp {
            op: BinOp::Mul,
            left,
            right,
        } => {
            collect_mul_children(left, out);
            collect_mul_children(right, out);
        }
        other => out.push(other),
    }
}

fn unwrap_parens(node: &ASTNode) -> &ASTNode {
    match node {
        ASTNode::Paren(inner) => unwrap_parens(inner),
        other => other,
    }
}

/// Flat row-major grid for SUMPRODUCT — avoids `Vec<Vec<f64>>` overhead.
///
/// For a column range of N rows (the dominant case), this is a single
/// contiguous allocation of N f64s instead of N 1-element Vecs.
struct FlatGrid {
    data: Vec<f64>,
    rows: usize,
    cols: usize,
}

impl FlatGrid {
    /// Convert a CellValue (possibly Array) to a flat f64 grid.
    /// Uses SUMPRODUCT-specific coercion: all text → 0.0, errors propagate.
    /// Used by the **multi-arg** path: `SUMPRODUCT(array1, array2)`.
    fn from_cell_value(val: &CellValue) -> Result<Self, CellError> {
        Self::from_cell_value_inner(val, coerce_for_sumproduct)
    }

    /// Convert a CellValue to a flat f64 grid using arithmetic coercion.
    /// Text → #VALUE! (matching the `*` operator), not 0.
    /// Used by the **fused single-arg** path: `SUMPRODUCT(expr1 * expr2)`.
    fn from_cell_value_strict(val: &CellValue) -> Result<Self, CellError> {
        Self::from_cell_value_inner(val, coerce_arithmetic)
    }

    fn from_cell_value_inner(
        val: &CellValue,
        coerce: fn(&CellValue) -> Result<f64, CellError>,
    ) -> Result<Self, CellError> {
        match val {
            CellValue::Array(arr) => {
                let rows = arr.rows();
                let cols = arr.cols();
                let mut data = Vec::with_capacity(rows * cols);
                for r in 0..rows {
                    for c in 0..cols {
                        let v = arr.get(r, c).unwrap_or(&CellValue::Null);
                        data.push(coerce(v)?);
                    }
                }
                Ok(FlatGrid { data, rows, cols })
            }
            other => Ok(FlatGrid {
                data: vec![coerce(other)?],
                rows: 1,
                cols: 1,
            }),
        }
    }

    #[inline]
    fn get(&self, r: usize, c: usize) -> f64 {
        let ri = if self.rows == 1 { 0 } else { r };
        let ci = if self.cols == 1 { 0 } else { c };
        debug_assert!(
            ri < self.rows && ci < self.cols,
            "FlatGrid index out of bounds: ({}, {}) with dims ({}, {})",
            ri,
            ci,
            self.rows,
            self.cols
        );
        self.data[ri * self.cols + ci]
    }
}

/// Flat multiply-accumulate with broadcasting.
fn multiply_accumulate_flat(grids: &[FlatGrid]) -> Result<CellValue, ComputeError> {
    if grids.is_empty() {
        return Ok(CellValue::Error(CellError::Value, None));
    }

    // Find common dimensions with broadcasting
    let mut common_rows: usize = 1;
    let mut common_cols: usize = 1;
    for g in grids {
        if g.rows > 1 {
            if common_rows == 1 {
                common_rows = g.rows;
            } else if g.rows != common_rows {
                return Ok(CellValue::Error(CellError::Value, None));
            }
        }
        if g.cols > 1 {
            if common_cols == 1 {
                common_cols = g.cols;
            } else if g.cols != common_cols {
                return Ok(CellValue::Error(CellError::Value, None));
            }
        }
    }

    let mut sum = KahanSum::new();
    for r in 0..common_rows {
        for c in 0..common_cols {
            let mut product = 1.0f64;
            for g in grids {
                product *= g.get(r, c);
            }
            sum.add(product);
        }
    }
    Ok(CellValue::number(sum.total()))
}

/// Convert a CellValue to a 2D boolean grid for use as a condition mask.
///
/// Coercion: Number != 0 → true, Boolean passthrough, Null → false.
/// Returns `None` if the value isn't coercible to a boolean grid (e.g. text, errors).
fn to_bool_2d(val: &CellValue) -> Option<Vec<Vec<bool>>> {
    match val {
        CellValue::Array(arr) => {
            let mut result = Vec::with_capacity(arr.rows());
            for row in arr.rows_iter() {
                let mut brow = Vec::with_capacity(row.len());
                for cell in row {
                    brow.push(coerce_cell_to_bool(cell)?);
                }
                result.push(brow);
            }
            Some(result)
        }
        other => Some(vec![vec![coerce_cell_to_bool(other)?]]),
    }
}

fn coerce_cell_to_bool(val: &CellValue) -> Option<bool> {
    match val {
        CellValue::Boolean(b) => Some(*b),
        CellValue::Number(n) => Some(n.get() != 0.0),
        CellValue::Null => Some(false),
        CellValue::Error(..) => None, // errors fall through to standard path
        _ => None,
    }
}

/// SUMPRODUCT-specific coercion for the **multi-arg** path: treats ALL text
/// (empty and non-empty) as 0.0. This matches Excel's behavior for
/// `SUMPRODUCT(array1, array2)` where text values in individual arrays are
/// silently treated as 0 in pairwise products, but errors still propagate.
fn coerce_for_sumproduct(val: &CellValue) -> Result<f64, CellError> {
    match val {
        CellValue::Number(n) => Ok(n.get()),
        CellValue::Null => Ok(0.0),
        CellValue::Boolean(b) => Ok(if *b { 1.0 } else { 0.0 }),
        CellValue::Text(_) => Ok(0.0),
        CellValue::Error(e, _) => Err(*e),
        _ => Err(CellError::Value), // Array, Lambda
    }
}

/// Arithmetic coercion for the **fused single-arg** path: matches the `*`
/// operator's type handling. Text → #VALUE! (empty text or non-numeric text),
/// parseable numeric text → number. This ensures `SUMPRODUCT(A*B)` where B
/// contains text returns #VALUE!, matching Excel.
fn coerce_arithmetic(val: &CellValue) -> Result<f64, CellError> {
    match val {
        CellValue::Number(n) => Ok(n.get()),
        CellValue::Null => Ok(0.0),
        CellValue::Boolean(b) => Ok(if *b { 1.0 } else { 0.0 }),
        CellValue::Text(_) => val.coerce_to_number(),
        CellValue::Error(e, _) => Err(*e),
        _ => Err(CellError::Value),
    }
}
