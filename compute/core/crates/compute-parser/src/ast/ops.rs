/// Binary operators in order of how they appear in formulas.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode, BinOp};
///
/// let ast = parse_formula("=A1+B1", None).unwrap().into_inner();
/// match ast {
///     ASTNode::BinaryOp { op, .. } => assert_eq!(op, BinOp::Add),
///     _ => panic!("expected binary op"),
/// }
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BinOp {
    /// Addition: `+`
    Add,
    /// Subtraction: `-`
    Sub,
    /// Multiplication: `*`
    Mul,
    /// Division: `/`
    Div,
    /// Exponentiation: `^` (right-associative)
    Pow,
    /// String concatenation: `&`
    Concat,
    /// Equality: `=`
    Eq,
    /// Inequality: `<>`
    Neq,
    /// Less than: `<`
    Lt,
    /// Greater than: `>`
    Gt,
    /// Less than or equal: `<=`
    Lte,
    /// Greater than or equal: `>=`
    Gte,
    /// Range intersection (space operator): `A1:B10 B5:C20`.
    ///
    /// In Excel, two range expressions separated only by whitespace produce
    /// the intersection of those ranges. Parsed via speculative lookahead in
    /// the Pratt loop (`try_intersection` in the expression grammar).
    Intersect,
}

/// Unary operators.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode, UnaryOp};
///
/// let ast = parse_formula("=-A1", None).unwrap().into_inner();
/// match ast {
///     ASTNode::UnaryOp { op, .. } => assert_eq!(op, UnaryOp::Minus),
///     _ => panic!("expected unary op"),
/// }
///
/// let ast = parse_formula("=50%", None).unwrap().into_inner();
/// match ast {
///     ASTNode::UnaryOp { op, .. } => assert_eq!(op, UnaryOp::Percent),
///     _ => panic!("expected unary op"),
/// }
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UnaryOp {
    Plus,
    Minus,
    Percent,
    /// Excel `@` implicit-intersection prefix operator.
    ///
    /// Forces a multi-cell range or array expression to collapse to a single
    /// scalar via row-aligned (for column ranges) or column-aligned (for row
    /// ranges) implicit intersection relative to the formula's own cell
    /// position. For 2-D ranges, picks the cell at (`caller_row`, `caller_col`).
    /// If no alignment is possible, evaluates to `#VALUE!`.
    ///
    /// Examples (caller in C3):
    ///   =@A1:A5  → A3   (column range, row-aligned)
    ///   =@A3:E3  → C3   (row range, column-aligned)
    ///   =@A1:E5  → C3   (2-D range, both aligned)
    ///   =@A1:A2  → #VALUE! (caller row 3 not in 1..=2)
    ///
    /// The parser produces this prefix anywhere `+`/`-` would be accepted.
    /// Inside `[ ]` brackets, `@` is part of structured-table syntax and is
    /// NOT a unary operator (handled by the structured-ref parser).
    ImplicitIntersection,
}

impl std::fmt::Display for BinOp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Add => write!(f, "+"),
            Self::Sub => write!(f, "-"),
            Self::Mul => write!(f, "*"),
            Self::Div => write!(f, "/"),
            Self::Pow => write!(f, "^"),
            Self::Concat => write!(f, "&"),
            Self::Eq => write!(f, "="),
            Self::Neq => write!(f, "<>"),
            Self::Lt => write!(f, "<"),
            Self::Gt => write!(f, ">"),
            Self::Lte => write!(f, "<="),
            Self::Gte => write!(f, ">="),
            Self::Intersect => write!(f, " "),
        }
    }
}

impl std::fmt::Display for UnaryOp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Plus => write!(f, "+"),
            Self::Minus => write!(f, "-"),
            Self::Percent => write!(f, "%"),
            Self::ImplicitIntersection => write!(f, "@"),
        }
    }
}
