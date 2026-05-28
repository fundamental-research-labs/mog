/// A parsed calculated field expression.
#[derive(Debug, Clone, PartialEq)]
pub enum CalcFieldExpr {
    /// Numeric literal (e.g., `100`, `3.14`).
    Number(f64),
    /// Reference to another field by name (e.g., `Revenue`, `'Cost of Goods'`).
    FieldRef(String),
    /// Binary arithmetic operation.
    BinaryOp {
        /// The arithmetic operator.
        op: CalcFieldOp,
        /// Left-hand operand.
        left: Box<CalcFieldExpr>,
        /// Right-hand operand.
        right: Box<CalcFieldExpr>,
    },
    /// Unary negation (e.g., `-Revenue`).
    Negate(Box<CalcFieldExpr>),
}

/// Binary arithmetic operators.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalcFieldOp {
    /// Addition (`+`).
    Add,
    /// Subtraction (`-`).
    Sub,
    /// Multiplication (`*`).
    Mul,
    /// Division (`/`).
    Div,
}
