//! Thin entry point — strips the leading `=`, delegates to the expression grammar,
//! and wraps winnow errors into `ParseError`.

use winnow::prelude::*;

use super::CellRefResolver;
use super::ast::{ASTNode, Span, Spanned};
use super::expressions;
use super::lexer;
use super::state::ParseState;

/// Classifies the kind of parse error for programmatic handling.
///
/// # Examples
///
/// Match on the error kind for specific error handling:
///
/// ```
/// use compute_parser::{parse_formula, ParseErrorKind};
///
/// match parse_formula("=SUM(1,2", None) {
///     Err(e) => match e.kind {
///         ParseErrorKind::UnmatchedParen { .. } => { /* handle unclosed paren */ }
///         _ => { /* other error */ }
///     },
///     Ok(_) => {}
/// }
/// ```
#[must_use]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum ParseErrorKind {
    // ── Existing (backward compat) ──────────────────────────────────
    /// Formula was empty or contained only `=`.
    Empty,
    /// Recursion depth exceeded `MAX_DEPTH`.
    MaxDepthExceeded,
    /// Valid prefix parsed successfully but trailing garbage remains.
    TrailingInput,

    // ── Specific structural errors ──────────────────────────────────
    /// Opening parenthesis at `open_pos` has no matching `)`.
    UnmatchedParen { open_pos: usize },
    /// Opening brace at `open_pos` has no matching `}`.
    UnmatchedBrace { open_pos: usize },
    /// Expected an expression but found something else.
    ExpectedExpression,
    /// Expected a function argument but found something else.
    ExpectedArgument,
    /// An operator was found where a value/operand was expected (e.g. `=1+*2`).
    ExpectedOperand,
    /// Function call has more arguments than the parser limit (4096).
    TooManyArguments,
    /// Expected a closing `}` for an array literal.
    ExpectedClosingBracket,
    /// Expected a closing `)` for a parenthesized expression or function call.
    ExpectedClosingParen,

    // ── Reference validation errors ─────────────────────────────────
    /// Malformed cell reference (generic).
    InvalidCellReference,
    /// Row number exceeds the 1 048 576 limit.
    InvalidRowNumber { row: u32 },
    /// Column number exceeds the 16 384 (XFD) limit.
    InvalidColumnNumber { col: u32 },
    /// Sheet name could not be resolved.
    UnknownSheetName { name: String },

    // ── Literal errors ──────────────────────────────────────────────
    /// Structured reference could not be parsed.
    MalformedStructuredRef { detail: String },
    /// Unterminated or invalid string literal.
    MalformedString,
    /// Invalid numeric literal.
    MalformedNumber,
    /// Invalid array literal.
    MalformedArrayLiteral,

    // ── Catch-all ───────────────────────────────────────────────────
    /// Generic parse failure (unexpected token).
    UnexpectedToken,
    /// Malformed cell reference (legacy catch-all).
    InvalidReference,
}

impl std::fmt::Display for ParseErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(f, "formula is empty"),
            Self::MaxDepthExceeded => write!(f, "maximum nesting depth exceeded"),
            Self::TrailingInput => write!(f, "unexpected trailing input"),

            Self::UnmatchedParen { open_pos } => {
                write!(f, "expected ')' to close '(' at position {open_pos}")
            }
            Self::UnmatchedBrace { open_pos } => {
                write!(f, "expected '}}' to close '{{' at position {open_pos}")
            }
            Self::ExpectedExpression => write!(f, "expected an expression"),
            Self::ExpectedArgument => write!(f, "expected a function argument"),
            Self::ExpectedOperand => write!(f, "expected an operand after operator"),
            Self::TooManyArguments => write!(f, "too many arguments (limit is 4096)"),
            Self::ExpectedClosingBracket => write!(f, "expected '}}' to close array literal"),
            Self::ExpectedClosingParen => write!(f, "expected ')' to close parenthesis"),

            Self::InvalidCellReference => write!(f, "invalid cell reference"),
            Self::InvalidRowNumber { row } => {
                write!(f, "row {row} exceeds maximum (1048576)")
            }
            Self::InvalidColumnNumber { col } => {
                write!(f, "column {col} exceeds maximum (16384)")
            }
            Self::UnknownSheetName { name } => {
                write!(f, "unknown sheet name '{name}'")
            }

            Self::MalformedStructuredRef { detail } => {
                write!(f, "malformed structured reference: {detail}")
            }
            Self::MalformedString => write!(f, "malformed string literal"),
            Self::MalformedNumber => write!(f, "malformed numeric literal"),
            Self::MalformedArrayLiteral => write!(f, "malformed array literal"),

            Self::UnexpectedToken => write!(f, "unexpected token"),
            Self::InvalidReference => write!(f, "invalid reference"),
        }
    }
}

/// Parse error with location information and structured error kind.
///
/// # Examples
///
/// Inspect the structured error kind and position:
///
/// ```
/// use compute_parser::{parse_formula, ParseError, ParseErrorKind};
///
/// let err: ParseError = parse_formula("=", None).unwrap_err();
/// assert_eq!(err.kind, ParseErrorKind::Empty);
/// // Human-readable message:
/// assert_eq!(err.message(), "formula is empty");
/// ```
#[must_use = "parse errors should be handled or propagated"]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Structured error classification.
    pub kind: ParseErrorKind,
    /// Byte range in the original input where the error was detected.
    pub span: Span,
}

impl ParseError {
    /// Construct a new `ParseError`.
    pub const fn new(kind: ParseErrorKind, span: Span) -> Self {
        Self { kind, span }
    }

    /// Byte offset where the error was detected (convenience for `self.span.start`).
    #[must_use]
    pub const fn position(&self) -> usize {
        self.span.start as usize
    }

    /// Human-readable error message derived from the `kind`.
    ///
    /// Provided for backward compatibility with code that previously read
    /// the now-removed `message` field. Equivalent to `self.kind.to_string()`.
    #[must_use]
    pub fn message(&self) -> String {
        self.kind.to_string()
    }
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Parse error at position {}: {}",
            self.span.start, self.kind
        )
    }
}

impl std::error::Error for ParseError {}

/// Main entry point: parse a formula string into a spanned AST.
///
/// The formula may optionally start with `=`. If `resolver` is provided,
/// cell references are resolved to `CellRef::Resolved` when possible.
///
/// Returns a [`Spanned<ASTNode>`] on success — the span covers the entire
/// parsed expression (byte offsets relative to the formula body after `=`).
///
/// Returns `Err(ParseError)` for empty, malformed, or depth-exceeded formulas.
///
/// # Errors
///
/// Returns [`ParseError`] when the formula is empty, syntactically invalid,
/// has unmatched parentheses/braces, or exceeds the maximum nesting depth.
///
/// # Examples
///
/// Basic usage — parse a formula without a resolver:
///
/// ```
/// use compute_parser::{parse_formula, ASTNode, BinOp};
///
/// let spanned = parse_formula("=1+2", None).unwrap();
/// match spanned.node {
///     ASTNode::BinaryOp { op: BinOp::Add, .. } => { /* addition */ }
///     _ => panic!("expected binary add"),
/// }
/// ```
///
/// Handling parse errors:
///
/// ```
/// use compute_parser::{parse_formula, ParseErrorKind};
///
/// let err = parse_formula("", None).unwrap_err();
/// assert_eq!(err.kind, ParseErrorKind::Empty);
/// ```
#[must_use = "the parsed AST should be used; call .unwrap() or handle the error"]
#[allow(clippy::cast_possible_truncation)] // formula lengths are always < u32::MAX
pub fn parse_formula(
    input: &str,
    resolver: Option<&dyn CellRefResolver>,
) -> Result<Spanned<ASTNode>, ParseError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ParseError::new(
            ParseErrorKind::Empty,
            Span::new(0, input.len() as u32),
        ));
    }

    let mut remaining = trimmed;

    // Consume optional leading '='
    if remaining.starts_with('=') {
        // starts_with('=') guarantees byte 0 is single-byte ASCII '='.
        #[allow(clippy::string_slice)]
        let rest = &remaining[1..];
        remaining = rest;
    }

    // Skip leading whitespace
    let _ = lexer::ws.parse_next(&mut remaining).ok();

    if remaining.is_empty() {
        return Err(ParseError::new(
            ParseErrorKind::Empty,
            Span::new(1, input.len() as u32),
        ));
    }

    // `remaining` is now the formula body — record it for offset tracking.
    let formula_input = remaining;
    let state = ParseState::new(resolver, formula_input);
    match expressions::parse_expression(&mut remaining, &state) {
        Ok(ast) => {
            let end = state.offset(remaining);
            // Skip trailing whitespace
            let _ = lexer::ws.parse_next(&mut remaining).ok();
            if remaining.is_empty() {
                Ok(Spanned {
                    span: Span::new(0, end),
                    node: ast,
                })
            } else {
                let pos = (input.len() - remaining.len()) as u32;
                Err(ParseError::new(
                    ParseErrorKind::TrailingInput,
                    Span::new(pos, input.len() as u32),
                ))
            }
        }
        Err(_e) => {
            let pos = input.len() - remaining.len();

            // If a cut error propagated a structured ParseErrorKind (set by the
            // parser before raising the cut), use it. Otherwise fall back to
            // generic classification.
            let kind = if let Some(k) = state.last_error_kind.take() {
                k
            } else if state.depth_exceeded.get() {
                ParseErrorKind::MaxDepthExceeded
            } else {
                ParseErrorKind::UnexpectedToken
            };

            let pos = pos as u32;
            Err(ParseError::new(kind, Span::new(pos, input.len() as u32)))
        }
    }
}

#[cfg(test)]
#[path = "parser_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "parser_tests_operators.rs"]
mod parser_tests_operators;

#[cfg(test)]
#[path = "parser_tests_functions.rs"]
mod parser_tests_functions;

#[cfg(test)]
#[path = "parser_tests_errors.rs"]
mod parser_tests_errors;

#[cfg(test)]
#[path = "parser_tests_display.rs"]
mod parser_tests_display;

#[cfg(test)]
#[path = "proptest_tests.rs"]
mod proptest_tests;

#[cfg(test)]
#[path = "precedence_tests.rs"]
mod precedence_tests;

#[cfg(test)]
#[path = "range_intersection_tests.rs"]
mod range_intersection_tests;

#[cfg(test)]
#[path = "edge_case_tests.rs"]
mod edge_case_tests;

#[cfg(test)]
#[path = "coverage_references_tests.rs"]
mod coverage_references_tests;

#[cfg(test)]
#[path = "coverage_expressions_tests.rs"]
mod coverage_expressions_tests;

#[cfg(test)]
#[path = "coverage_misc_tests.rs"]
mod coverage_misc_tests;

#[cfg(test)]
#[path = "union_tests.rs"]
mod union_tests;
