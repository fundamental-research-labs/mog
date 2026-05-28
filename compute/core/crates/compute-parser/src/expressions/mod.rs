//! Expression grammar — Pratt parser (precedence climbing).
//!
//! Operator precedence (lowest to highest):
//! 1. Comparison: =, <>, <, >, <=, >=
//! 2. Concatenation: &
//! 3. Addition/Subtraction: +, -
//! 4. Multiplication/Division: *, /
//! 5. Power: ^ (right-associative)
//! 6. Unary: +, -, @
//! 7. Percent and call expressions
//! 8. Intersection: implicit whitespace between range-like expressions
//! 9. Expression-level range operator: :
//! 10. Atomic: literals, references, function calls, parens
//!
//! The Pratt loop in [`pratt`] owns precedence orchestration. Binding powers
//! live in [`binding`], postfix operators and call expressions in [`postfix`],
//! range/intersection/union grammar in [`range_ops`], function argument lists
//! in [`args`], atomic dispatch in [`atom`], alpha-starting lookahead in
//! [`alpha`], array literals in [`arrays`], and external workbook references
//! in [`external`].
//!
//! # Intersection operator (space)
//!
//! Excel's intersection operator is implicit whitespace between two range
//! expressions: `A1:B10 B5:C20` returns the overlapping cells. The parser
//! handles this by speculatively trying to parse a range-like expression
//! after consuming whitespace when the current LHS is itself range-like.
//! If the speculative parse succeeds, `BinOp::Intersect` is emitted;
//! otherwise the parser backtracks and continues with normal operator dispatch.
//!
//! # Union operator (comma in range context)
//!
//! Excel's union operator uses a comma inside parenthesized range contexts:
//! `SUM((A1:A5,C1:C5))`. The comma already serves as the function argument
//! separator, so the parser distinguishes the two uses based on context:
//! when parsing a parenthesized expression (not a function call's argument
//! list) and the first sub-expression is range-like, commas are treated as
//! the union operator. This produces `ASTNode::Union { ranges }`.
//! Precedence: union is implicitly lowest since it's only parsed inside
//! explicit parentheses.

mod alpha;
mod args;
mod arrays;
mod atom;
mod binding;
mod external;
mod postfix;
mod pratt;
mod range_ops;

pub use alpha::{try_parse_cell_or_range_or_func, try_parse_function_call};
pub use pratt::parse_expression;
pub use range_ops::{is_callable, is_range_endpoint, is_range_like};
