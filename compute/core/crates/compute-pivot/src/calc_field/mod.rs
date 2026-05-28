//! Calculated field expression parsing and evaluation.
//!
//! Calculated fields create derived value columns in a pivot table using formulas
//! that reference other fields. The formula operates on **aggregated values** — after
//! Sum/Average/etc. has been applied to each cell.
//!
//! # Expression Language
//!
//! - **Field references**: bare identifiers like `Revenue` or quoted like `'Cost of Goods'`
//!   or `"Cost of Goods"`.
//! - **Numeric literals**: `100`, `3.14`, `.5`
//! - **Arithmetic operators**: `+`, `-`, `*`, `/` with standard precedence
//!   (`*` and `/` bind tighter than `+` and `-`).
//! - **Parentheses**: `(Revenue - Cost) / Revenue`
//! - **Unary negation**: `-Revenue`, `-(Revenue + Cost)`
//!
//! # Examples
//!
//! ```
//! use compute_pivot::{parse_calc_field, evaluate_calc_field, CalcFieldExpr, CalcFieldOp};
//! use std::collections::HashMap;
//!
//! // Parse a simple formula
//! let expr = parse_calc_field("Revenue / Units").unwrap();
//!
//! // Evaluate with concrete field values
//! let mut fields = HashMap::new();
//! fields.insert("Revenue", 10000.0);
//! fields.insert("Units", 100.0);
//! assert_eq!(evaluate_calc_field(&expr, &fields), Some(100.0));
//! ```

mod ast;
mod error;
mod evaluator;
mod lexer;
mod parser;

#[cfg(test)]
mod error_tests;
#[cfg(test)]
mod evaluator_tests;
#[cfg(test)]
mod parser_tests;

pub use ast::{CalcFieldExpr, CalcFieldOp};
pub use error::CalcFieldParseError;
pub use evaluator::evaluate_calc_field;

/// Maximum recursion depth for parsing and evaluation to prevent stack overflow.
const MAX_DEPTH: usize = 100;

/// Parse a calculated field formula string into an expression AST.
///
/// Supports:
/// - Field references: `Revenue`, `'Cost of Goods'`, `"Units Sold"`
/// - Arithmetic: `+`, `-`, `*`, `/`
/// - Parentheses: `(Revenue - Cost) / Revenue`
/// - Unary negation: `-Revenue`
/// - Numeric literals: `100`, `3.14`
///
/// # Examples
///
/// ```
/// use compute_pivot::parse_calc_field;
///
/// let expr = parse_calc_field("Revenue / Units").unwrap();
/// let complex = parse_calc_field("(Revenue - Cost) / Revenue * 100").unwrap();
/// ```
///
/// # Errors
///
/// Returns a [`CalcFieldParseError`] on invalid input:
/// - [`CalcFieldParseError::UnexpectedToken`] for invalid characters or tokens
/// - [`CalcFieldParseError::UnmatchedParen`] for unclosed quotes or parentheses
/// - [`CalcFieldParseError::MaxDepthExceeded`] for deeply nested expressions
/// - [`CalcFieldParseError::EmptyExpression`] for empty or whitespace-only input
pub fn parse_calc_field(formula: &str) -> Result<CalcFieldExpr, CalcFieldParseError> {
    let trimmed = formula.trim();
    if trimmed.is_empty() {
        return Err(CalcFieldParseError::EmptyExpression);
    }

    let tokens = lexer::tokenize(trimmed)?;
    if tokens.is_empty() {
        return Err(CalcFieldParseError::EmptyExpression);
    }

    parser::parse_tokens(tokens)
}
