use ordered_float::OrderedFloat;
use smallvec::SmallVec;

use cell_types::{CellId, SheetId};

// ---------------------------------------------------------------------------
// VecOp — vectorizable formula pattern
// ---------------------------------------------------------------------------

/// A vectorizable formula pattern extracted from an AST.
/// Row-relative references are normalized to column offsets.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum VecOp {
    /// Relative column offset from output column.
    ColRef(i32),
    /// Numeric constant.
    Const(OrderedFloat<f64>),
    /// Binary arithmetic operation.
    BinOp(Box<VecOp>, ArithOp, Box<VecOp>),
    /// Single-argument math function.
    UnaryMath(MathFn, Box<VecOp>),
    /// Conditional: IF(left cmp right, then_val, else_val).
    Cond {
        left: Box<VecOp>,
        cmp: CmpOp,
        right: Box<VecOp>,
        then_val: Box<VecOp>,
        else_val: Box<VecOp>,
    },
    /// Unary negation.
    Neg(Box<VecOp>),
}

/// Arithmetic operations for vectorized evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArithOp {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

/// Comparison operations for conditional vectorized evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CmpOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

/// Math functions that can be vectorized (single-argument).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MathFn {
    Abs,
    Sqrt,
    Round0,
    Round2,
    Ln,
    Exp,
    Floor,
    Ceiling,
    Int,
}

// ---------------------------------------------------------------------------
// SharedFormulaGroup
// ---------------------------------------------------------------------------

/// A group of consecutive cells sharing the same vectorizable formula pattern.
pub struct SharedFormulaGroup {
    /// Sheet containing the group.
    pub sheet: SheetId,
    /// Output column index.
    pub col: u32,
    /// Start row (inclusive).
    pub start_row: u32,
    /// End row (exclusive).
    pub end_row: u32,
    /// The vectorizable pattern.
    pub pattern: VecOp,
    /// Cell IDs in the group (ordered by row).
    pub cell_ids: Vec<CellId>,
    /// Input columns referenced by the pattern: (sheet, col).
    pub input_columns: SmallVec<[(SheetId, u32); 4]>,
}
