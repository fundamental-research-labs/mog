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

use std::collections::HashMap;
use std::fmt;
use std::hash::BuildHasher;

// ============================================================================
// Error Type
// ============================================================================

/// Error from parsing a calculated field expression.
#[derive(Debug, Clone, PartialEq)]
pub enum CalcFieldParseError {
    /// Unexpected token encountered during parsing.
    UnexpectedToken {
        /// String representation of the token.
        token: String,
        /// 1-based position in the input.
        position: usize,
    },
    /// Unmatched parenthesis or unclosed quote.
    UnmatchedParen {
        /// 1-based position of the unmatched delimiter.
        position: usize,
    },
    /// Expression nesting exceeded maximum depth.
    MaxDepthExceeded {
        /// The maximum allowed depth.
        max_depth: usize,
    },
    /// Expression is empty or contains no tokens.
    EmptyExpression,
}

impl fmt::Display for CalcFieldParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CalcFieldParseError::UnexpectedToken { token, position } => {
                write!(f, "Unexpected token '{token}' at position {position}")
            }
            CalcFieldParseError::UnmatchedParen { position } => {
                write!(f, "Unmatched parenthesis at position {position}")
            }
            CalcFieldParseError::MaxDepthExceeded { max_depth } => {
                write!(f, "Expression exceeds maximum nesting depth of {max_depth}")
            }
            CalcFieldParseError::EmptyExpression => {
                write!(f, "Empty expression")
            }
        }
    }
}

impl std::error::Error for CalcFieldParseError {}

// ============================================================================
// AST Types
// ============================================================================

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

// ============================================================================
// Tokenizer
// ============================================================================

/// Token types produced by the lexer.
#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

/// Tokenize a formula string into a sequence of tokens.
///
/// Returns an error with a descriptive message on invalid input.
fn tokenize(input: &str) -> Result<Vec<Token>, CalcFieldParseError> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];

        // Skip whitespace
        if ch.is_ascii_whitespace() {
            i += 1;
            continue;
        }

        match ch {
            '+' => {
                tokens.push(Token::Plus);
                i += 1;
            }
            '-' => {
                tokens.push(Token::Minus);
                i += 1;
            }
            '*' => {
                tokens.push(Token::Star);
                i += 1;
            }
            '/' => {
                tokens.push(Token::Slash);
                i += 1;
            }
            '(' => {
                tokens.push(Token::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                i += 1;
            }

            // Numeric literal: digits, optional dot, more digits
            '0'..='9' | '.'
                if {
                    // Only treat '.' as start of number if followed by a digit
                    ch != '.' || (i + 1 < len && chars[i + 1].is_ascii_digit())
                } =>
            {
                let start = i;
                let mut has_dot = ch == '.';
                i += 1;
                while i < len {
                    if chars[i].is_ascii_digit() {
                        i += 1;
                    } else if chars[i] == '.' && !has_dot {
                        has_dot = true;
                        i += 1;
                    } else {
                        break;
                    }
                }
                let num_str: String = chars[start..i].iter().collect();
                let value =
                    num_str
                        .parse::<f64>()
                        .map_err(|_| CalcFieldParseError::UnexpectedToken {
                            token: num_str.clone(),
                            position: start + 1,
                        })?;
                tokens.push(Token::Number(value));
            }

            // Quoted field reference with single quotes ('' is an escaped quote)
            '\'' => {
                let start = i;
                i += 1; // skip opening quote
                let mut name = String::new();
                while i < len {
                    if chars[i] == '\'' {
                        // Check for escaped quote ''
                        if i + 1 < len && chars[i + 1] == '\'' {
                            name.push('\'');
                            i += 2;
                            continue;
                        }
                        break; // End of quoted name
                    }
                    name.push(chars[i]);
                    i += 1;
                }
                if i >= len {
                    return Err(CalcFieldParseError::UnmatchedParen {
                        position: start + 1,
                    });
                }
                i += 1; // skip closing quote
                if name.is_empty() {
                    return Err(CalcFieldParseError::UnexpectedToken {
                        token: "''".to_string(),
                        position: start + 1,
                    });
                }
                tokens.push(Token::Ident(name));
            }

            // Quoted field reference with double quotes ("" is an escaped quote)
            '"' => {
                let start = i;
                i += 1; // skip opening quote
                let mut name = String::new();
                while i < len {
                    if chars[i] == '"' {
                        // Check for escaped quote ""
                        if i + 1 < len && chars[i + 1] == '"' {
                            name.push('"');
                            i += 2;
                            continue;
                        }
                        break; // End of quoted name
                    }
                    name.push(chars[i]);
                    i += 1;
                }
                if i >= len {
                    return Err(CalcFieldParseError::UnmatchedParen {
                        position: start + 1,
                    });
                }
                i += 1; // skip closing quote
                if name.is_empty() {
                    return Err(CalcFieldParseError::UnexpectedToken {
                        token: "\"\"".to_string(),
                        position: start + 1,
                    });
                }
                tokens.push(Token::Ident(name));
            }

            // Bare identifier (field reference)
            _ if ch.is_alphabetic() || ch == '_' => {
                let start = i;
                i += 1;
                while i < len && (chars[i].is_alphanumeric() || chars[i] == '_') {
                    i += 1;
                }
                let name: String = chars[start..i].iter().collect();
                tokens.push(Token::Ident(name));
            }

            _ => {
                return Err(CalcFieldParseError::UnexpectedToken {
                    token: ch.to_string(),
                    position: i + 1,
                });
            }
        }
    }

    Ok(tokens)
}

// ============================================================================
// Recursive-descent parser
// ============================================================================

/// Maximum recursion depth for parsing and evaluation to prevent stack overflow.
const MAX_DEPTH: usize = 100;

/// Parser state: wraps a token stream with a cursor.
struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    depth: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Parser {
            tokens,
            pos: 0,
            depth: 0,
        }
    }

    /// Increment recursion depth, returning an error if the limit is exceeded.
    fn enter(&mut self) -> Result<(), CalcFieldParseError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(CalcFieldParseError::MaxDepthExceeded {
                max_depth: MAX_DEPTH,
            });
        }
        Ok(())
    }

    /// Decrement recursion depth.
    fn leave(&mut self) {
        self.depth -= 1;
    }

    /// Peek at the current token without consuming it.
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    /// Consume the current token and advance.
    fn advance(&mut self) -> Option<Token> {
        if self.pos < self.tokens.len() {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(tok)
        } else {
            None
        }
    }

    /// Parse an expression (entry point): handles `+` and `-` (lowest precedence).
    ///
    /// Grammar:
    /// ```text
    /// expr     = term (('+' | '-') term)*
    /// term     = unary (('*' | '/') unary)*
    /// unary    = '-' unary | primary
    /// primary  = NUMBER | IDENT | '(' expr ')'
    /// ```
    fn parse_expr(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let mut left = self.parse_term()?;

        loop {
            match self.peek() {
                Some(Token::Plus) => {
                    self.advance();
                    let right = self.parse_term()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Add,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                Some(Token::Minus) => {
                    self.advance();
                    let right = self.parse_term()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Sub,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                _ => break,
            }
        }

        self.leave();
        Ok(left)
    }

    /// Parse a term: handles `*` and `/` (higher precedence than +/-).
    fn parse_term(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let mut left = self.parse_unary()?;

        loop {
            match self.peek() {
                Some(Token::Star) => {
                    self.advance();
                    let right = self.parse_unary()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Mul,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                Some(Token::Slash) => {
                    self.advance();
                    let right = self.parse_unary()?;
                    left = CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Div,
                        left: Box::new(left),
                        right: Box::new(right),
                    };
                }
                _ => break,
            }
        }

        self.leave();
        Ok(left)
    }

    /// Parse a unary expression: handles unary negation.
    fn parse_unary(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let result = if let Some(Token::Minus) = self.peek() {
            self.advance();
            let inner = self.parse_unary()?;
            Ok(CalcFieldExpr::Negate(Box::new(inner)))
        } else {
            self.parse_primary()
        };
        self.leave();
        result
    }

    /// Parse a primary expression: number literal, field reference, or parenthesized expr.
    fn parse_primary(&mut self) -> Result<CalcFieldExpr, CalcFieldParseError> {
        self.enter()?;
        let result = match self.advance() {
            Some(Token::Number(n)) => Ok(CalcFieldExpr::Number(n)),
            Some(Token::Ident(name)) => Ok(CalcFieldExpr::FieldRef(name)),
            Some(Token::LParen) => {
                let paren_pos = self.pos; // position after consuming '('
                let inner = self.parse_expr()?;
                match self.advance() {
                    Some(Token::RParen) => Ok(inner),
                    Some(other) => Err(CalcFieldParseError::UnexpectedToken {
                        token: format!("{other:?}"),
                        position: self.pos,
                    }),
                    None => Err(CalcFieldParseError::UnmatchedParen {
                        position: paren_pos,
                    }),
                }
            }
            Some(other) => Err(CalcFieldParseError::UnexpectedToken {
                token: format!("{other:?}"),
                position: self.pos,
            }),
            None => Err(CalcFieldParseError::EmptyExpression),
        };
        self.leave();
        result
    }
}

// ============================================================================
// Public API
// ============================================================================

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

    let tokens = tokenize(trimmed)?;
    if tokens.is_empty() {
        return Err(CalcFieldParseError::EmptyExpression);
    }

    let mut parser = Parser::new(tokens);
    let expr = parser.parse_expr()?;

    // Ensure all tokens were consumed
    if parser.pos < parser.tokens.len() {
        return Err(CalcFieldParseError::UnexpectedToken {
            token: format!("{:?}", parser.tokens[parser.pos]),
            position: parser.pos + 1,
        });
    }

    Ok(expr)
}

/// Evaluate a calculated field expression given field values.
///
/// Field name lookup is case-insensitive, matching Excel behaviour.
///
/// Returns `None` if any referenced field is missing or has a null value,
/// or if division by zero occurs, if the result is NaN or infinite, or if
/// expression depth exceeds `MAX_DEPTH`.
///
/// # Examples
///
/// ```
/// use compute_pivot::{parse_calc_field, evaluate_calc_field};
/// use std::collections::HashMap;
///
/// let expr = parse_calc_field("Revenue / Units").unwrap();
/// let mut fields = HashMap::new();
/// fields.insert("Revenue", 10000.0);
/// fields.insert("Units", 100.0);
/// assert_eq!(evaluate_calc_field(&expr, &fields), Some(100.0));
/// ```
#[must_use]
pub fn evaluate_calc_field<S: BuildHasher>(
    expr: &CalcFieldExpr,
    field_values: &HashMap<&str, f64, S>,
) -> Option<f64> {
    evaluate_inner(expr, field_values, 0)
}

/// Recursive evaluator with depth tracking.
fn evaluate_inner<S: BuildHasher>(
    expr: &CalcFieldExpr,
    field_values: &HashMap<&str, f64, S>,
    depth: usize,
) -> Option<f64> {
    if depth > MAX_DEPTH {
        return None;
    }
    match expr {
        CalcFieldExpr::Number(n) => Some(*n),
        CalcFieldExpr::FieldRef(name) => {
            // Case-insensitive field lookup to match Excel behaviour.
            field_values
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| *v)
        }
        CalcFieldExpr::BinaryOp { op, left, right } => {
            let l = evaluate_inner(left, field_values, depth + 1)?;
            let r = evaluate_inner(right, field_values, depth + 1)?;
            let result = match op {
                CalcFieldOp::Add => l + r,
                CalcFieldOp::Sub => l - r,
                CalcFieldOp::Mul => l * r,
                CalcFieldOp::Div => {
                    if r == 0.0 {
                        return None;
                    }
                    l / r
                }
            };
            // Guard against NaN and Infinity
            if result.is_finite() {
                Some(result)
            } else {
                None
            }
        }
        CalcFieldExpr::Negate(inner) => evaluate_inner(inner, field_values, depth + 1).map(|v| -v),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Parser Tests ----

    #[test]
    fn test_parse_simple_division() {
        let expr = parse_calc_field("Revenue / Units").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Div,
                left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("Units".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_simple_addition() {
        let expr = parse_calc_field("Revenue + Cost").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Add,
                left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("Cost".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_complex_formula() {
        // (Revenue - Cost) / Revenue * 100
        let expr = parse_calc_field("(Revenue - Cost) / Revenue * 100").unwrap();
        // Should parse as ((Revenue - Cost) / Revenue) * 100
        // because * and / have same precedence, left-to-right associativity
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Mul,
                left: Box::new(CalcFieldExpr::BinaryOp {
                    op: CalcFieldOp::Div,
                    left: Box::new(CalcFieldExpr::BinaryOp {
                        op: CalcFieldOp::Sub,
                        left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
                        right: Box::new(CalcFieldExpr::FieldRef("Cost".to_string())),
                    }),
                    right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
                }),
                right: Box::new(CalcFieldExpr::Number(100.0)),
            }
        );
    }

    #[test]
    fn test_parse_single_quoted_field() {
        let expr = parse_calc_field("'Cost of Goods' / Revenue").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Div,
                left: Box::new(CalcFieldExpr::FieldRef("Cost of Goods".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_double_quoted_field() {
        let expr = parse_calc_field("\"Units Sold\" * Price").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Mul,
                left: Box::new(CalcFieldExpr::FieldRef("Units Sold".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("Price".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_unary_negation() {
        let expr = parse_calc_field("-Revenue + Cost").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Add,
                left: Box::new(CalcFieldExpr::Negate(Box::new(CalcFieldExpr::FieldRef(
                    "Revenue".to_string()
                )))),
                right: Box::new(CalcFieldExpr::FieldRef("Cost".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_double_negation() {
        let expr = parse_calc_field("--Revenue").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::Negate(Box::new(CalcFieldExpr::Negate(Box::new(
                CalcFieldExpr::FieldRef("Revenue".to_string())
            ))))
        );
    }

    #[test]
    fn test_parse_numeric_literal() {
        let expr = parse_calc_field("Revenue * 1.15").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Mul,
                left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
                right: Box::new(CalcFieldExpr::Number(1.15)),
            }
        );
    }

    #[test]
    fn test_parse_parenthesized_expression() {
        let expr = parse_calc_field("(A + B) * C").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Mul,
                left: Box::new(CalcFieldExpr::BinaryOp {
                    op: CalcFieldOp::Add,
                    left: Box::new(CalcFieldExpr::FieldRef("A".to_string())),
                    right: Box::new(CalcFieldExpr::FieldRef("B".to_string())),
                }),
                right: Box::new(CalcFieldExpr::FieldRef("C".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_nested_parentheses() {
        let expr = parse_calc_field("((A + B))").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Add,
                left: Box::new(CalcFieldExpr::FieldRef("A".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("B".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_precedence_mul_before_add() {
        // A + B * C should parse as A + (B * C)
        let expr = parse_calc_field("A + B * C").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Add,
                left: Box::new(CalcFieldExpr::FieldRef("A".to_string())),
                right: Box::new(CalcFieldExpr::BinaryOp {
                    op: CalcFieldOp::Mul,
                    left: Box::new(CalcFieldExpr::FieldRef("B".to_string())),
                    right: Box::new(CalcFieldExpr::FieldRef("C".to_string())),
                }),
            }
        );
    }

    #[test]
    fn test_parse_single_field() {
        let expr = parse_calc_field("Revenue").unwrap();
        assert_eq!(expr, CalcFieldExpr::FieldRef("Revenue".to_string()));
    }

    #[test]
    fn test_parse_single_number() {
        let expr = parse_calc_field("42").unwrap();
        assert_eq!(expr, CalcFieldExpr::Number(42.0));
    }

    #[test]
    fn test_parse_underscore_field() {
        let expr = parse_calc_field("total_revenue / unit_count").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Div,
                left: Box::new(CalcFieldExpr::FieldRef("total_revenue".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("unit_count".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_decimal_starting_with_dot() {
        let expr = parse_calc_field(".5 * Revenue").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Mul,
                left: Box::new(CalcFieldExpr::Number(0.5)),
                right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            }
        );
    }

    // ---- Parser Error Tests ----

    #[test]
    fn test_parse_empty_string() {
        assert_eq!(
            parse_calc_field("").unwrap_err(),
            CalcFieldParseError::EmptyExpression
        );
        assert_eq!(
            parse_calc_field("   ").unwrap_err(),
            CalcFieldParseError::EmptyExpression
        );
    }

    #[test]
    fn test_parse_unclosed_paren() {
        let err = parse_calc_field("(Revenue + Cost").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnmatchedParen { .. }),
            "Error should be UnmatchedParen: {err}",
        );
    }

    #[test]
    fn test_parse_extra_close_paren() {
        let err = parse_calc_field("Revenue + Cost)").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnexpectedToken { .. }),
            "Error should be UnexpectedToken: {err}",
        );
    }

    #[test]
    fn test_parse_unexpected_character() {
        let err = parse_calc_field("Revenue @ Cost").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnexpectedToken { ref token, .. } if token == "@"),
            "Error should mention the character: {err}",
        );
    }

    #[test]
    fn test_parse_missing_operand() {
        let err = parse_calc_field("Revenue +").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::EmptyExpression),
            "Error should be EmptyExpression: {err}",
        );
    }

    #[test]
    fn test_parse_consecutive_operators() {
        // Revenue + * Cost should fail
        let err = parse_calc_field("Revenue + * Cost").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnexpectedToken { .. }),
            "Error should be UnexpectedToken: {err}",
        );
    }

    #[test]
    fn test_parse_empty_quoted_field() {
        let err = parse_calc_field("'' + Revenue").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnexpectedToken { ref token, .. } if token == "''"),
            "Error should mention empty field: {err}",
        );
    }

    #[test]
    fn test_parse_unclosed_single_quote() {
        let err = parse_calc_field("'Cost of Goods + Revenue").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnmatchedParen { .. }),
            "Error should be UnmatchedParen for unclosed quote: {err}",
        );
    }

    #[test]
    fn test_parse_unclosed_double_quote() {
        let err = parse_calc_field("\"Cost of Goods + Revenue").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnmatchedParen { .. }),
            "Error should be UnmatchedParen for unclosed quote: {err}",
        );
    }

    // ---- Evaluator Tests ----

    #[test]
    fn test_evaluate_basic_arithmetic() {
        let mut fields = HashMap::new();
        fields.insert("A", 10.0);
        fields.insert("B", 3.0);

        let expr = parse_calc_field("A + B").unwrap();
        assert_eq!(evaluate_calc_field(&expr, &fields), Some(13.0));

        let expr = parse_calc_field("A - B").unwrap();
        assert_eq!(evaluate_calc_field(&expr, &fields), Some(7.0));

        let expr = parse_calc_field("A * B").unwrap();
        assert_eq!(evaluate_calc_field(&expr, &fields), Some(30.0));

        let expr = parse_calc_field("A / B").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - 10.0 / 3.0).abs() < 1e-10);
    }

    #[test]
    fn test_evaluate_division_by_zero() {
        let mut fields = HashMap::new();
        fields.insert("Revenue", 1000.0);
        fields.insert("Units", 0.0);

        let expr = parse_calc_field("Revenue / Units").unwrap();
        assert_eq!(evaluate_calc_field(&expr, &fields), None);
    }

    #[test]
    fn test_evaluate_missing_field() {
        let mut fields = HashMap::new();
        fields.insert("Revenue", 1000.0);
        // "Units" is not in the map

        let expr = parse_calc_field("Revenue / Units").unwrap();
        assert_eq!(evaluate_calc_field(&expr, &fields), None);
    }

    #[test]
    fn test_evaluate_complex_expression() {
        let mut fields = HashMap::new();
        fields.insert("Revenue", 1000.0);
        fields.insert("Cost", 600.0);

        // Profit margin: (Revenue - Cost) / Revenue * 100
        let expr = parse_calc_field("(Revenue - Cost) / Revenue * 100").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!(
            (result - 40.0).abs() < 1e-10,
            "Expected 40.0, got {}",
            result
        );
    }

    #[test]
    fn test_evaluate_negation() {
        let mut fields = HashMap::new();
        fields.insert("Revenue", 1000.0);
        fields.insert("Cost", 600.0);

        let expr = parse_calc_field("-Revenue + Cost").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - (-400.0)).abs() < 1e-10);
    }

    #[test]
    fn test_evaluate_numeric_literal() {
        let expr = parse_calc_field("42").unwrap();
        let fields = HashMap::new();
        assert_eq!(evaluate_calc_field(&expr, &fields), Some(42.0));
    }

    #[test]
    fn test_evaluate_with_numeric_multiplier() {
        let mut fields = HashMap::new();
        fields.insert("Revenue", 1000.0);

        let expr = parse_calc_field("Revenue * 1.15").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - 1150.0).abs() < 1e-10);
    }

    #[test]
    fn test_evaluate_nested_division_by_zero() {
        let mut fields = HashMap::new();
        fields.insert("A", 10.0);
        fields.insert("B", 0.0);
        fields.insert("C", 5.0);

        // (A / B) + C — division by zero in subexpression
        let expr = parse_calc_field("(A / B) + C").unwrap();
        assert_eq!(evaluate_calc_field(&expr, &fields), None);
    }

    #[test]
    fn test_evaluate_empty_fields() {
        let fields: HashMap<&str, f64> = HashMap::new();

        let expr = parse_calc_field("Revenue").unwrap();
        assert_eq!(evaluate_calc_field(&expr, &fields), None);
    }

    #[test]
    fn test_evaluate_all_operations_precedence() {
        let mut fields = HashMap::new();
        fields.insert("A", 2.0);
        fields.insert("B", 3.0);
        fields.insert("C", 4.0);
        fields.insert("D", 5.0);

        // A + B * C - D => 2 + 12 - 5 = 9
        let expr = parse_calc_field("A + B * C - D").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - 9.0).abs() < 1e-10);
    }

    #[test]
    fn test_evaluate_double_negation() {
        let mut fields = HashMap::new();
        fields.insert("Revenue", 1000.0);

        let expr = parse_calc_field("--Revenue").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - 1000.0).abs() < 1e-10);
    }

    #[test]
    fn test_evaluate_quoted_field_names() {
        let mut fields = HashMap::new();
        fields.insert("Cost of Goods", 600.0);
        fields.insert("Revenue", 1000.0);

        let expr = parse_calc_field("'Cost of Goods' / Revenue").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - 0.6).abs() < 1e-10);
    }

    // ---- Round-trip: parse + evaluate ----

    #[test]
    fn test_round_trip_complex_formula() {
        let mut fields = HashMap::new();
        fields.insert("Sales", 10000.0);
        fields.insert("Returns", 500.0);
        fields.insert("Units", 200.0);

        // Net revenue per unit: (Sales - Returns) / Units
        let expr = parse_calc_field("(Sales - Returns) / Units").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - 47.5).abs() < 1e-10);
    }

    // ---- Case-insensitive field lookup ----

    #[test]
    fn test_evaluate_case_insensitive_field_lookup() {
        let mut fields = HashMap::new();
        fields.insert("revenue", 1000.0);
        fields.insert("Units", 50.0);

        // Formula references "Revenue" (capital R) but map has "revenue" (lowercase)
        let expr = parse_calc_field("Revenue / Units").unwrap();
        let result = evaluate_calc_field(&expr, &fields).unwrap();
        assert!((result - 20.0).abs() < 1e-10);

        // Also verify mixed case: formula "UNITS" matches "Units"
        let expr2 = parse_calc_field("revenue / UNITS").unwrap();
        let result2 = evaluate_calc_field(&expr2, &fields).unwrap();
        assert!((result2 - 20.0).abs() < 1e-10);
    }

    // ---- Recursion depth limit ----

    #[test]
    fn test_parser_depth_limit() {
        // Build a deeply nested expression: (((((...A...)))))
        // 200 levels of parentheses should exceed MAX_DEPTH
        let mut formula = String::new();
        for _ in 0..200 {
            formula.push('(');
        }
        formula.push('A');
        for _ in 0..200 {
            formula.push(')');
        }
        let result = parse_calc_field(&formula);
        assert!(result.is_err(), "Should fail with depth limit");
        assert!(
            matches!(
                result.unwrap_err(),
                CalcFieldParseError::MaxDepthExceeded { max_depth: 100 }
            ),
            "Error should be MaxDepthExceeded"
        );
    }

    #[test]
    fn test_evaluator_depth_limit() {
        // Build a deeply nested AST manually: Negate(Negate(Negate(...Number(1.0)...)))
        let mut expr = CalcFieldExpr::Number(1.0);
        for _ in 0..150 {
            expr = CalcFieldExpr::Negate(Box::new(expr));
        }
        let fields = HashMap::new();
        // Should return None because depth exceeds MAX_DEPTH
        assert_eq!(evaluate_calc_field(&expr, &fields), None);
    }

    // ---- Escaped quotes in field names ----

    #[test]
    fn test_parse_escaped_single_quote() {
        // 'field''s name' should parse to field name: field's name
        let expr = parse_calc_field("'field''s name' + Revenue").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Add,
                left: Box::new(CalcFieldExpr::FieldRef("field's name".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            }
        );
    }

    #[test]
    fn test_parse_escaped_double_quote() {
        // "field""s name" should parse to field name: field"s name
        let expr = parse_calc_field("\"field\"\"s name\" + Revenue").unwrap();
        assert_eq!(
            expr,
            CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Add,
                left: Box::new(CalcFieldExpr::FieldRef("field\"s name".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            }
        );
    }

    // ---- PartialEq ----

    #[test]
    fn test_partial_eq_on_calc_field_expr() {
        let a = CalcFieldExpr::FieldRef("Revenue".to_string());
        let b = CalcFieldExpr::FieldRef("Revenue".to_string());
        let c = CalcFieldExpr::FieldRef("Cost".to_string());
        assert_eq!(a, b);
        assert_ne!(a, c);

        let op_a = CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::Number(1.0)),
            right: Box::new(CalcFieldExpr::Number(2.0)),
        };
        let op_b = CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::Number(1.0)),
            right: Box::new(CalcFieldExpr::Number(2.0)),
        };
        assert_eq!(op_a, op_b);

        assert_eq!(CalcFieldOp::Add, CalcFieldOp::Add);
        assert_ne!(CalcFieldOp::Add, CalcFieldOp::Sub);
    }

    // ---- Display impl coverage ----

    #[test]
    fn test_display_unmatched_paren() {
        let err = CalcFieldParseError::UnmatchedParen { position: 5 };
        let msg = format!("{err}");
        assert!(msg.contains("Unmatched parenthesis"));
        assert!(msg.contains("5"));
    }

    #[test]
    fn test_display_max_depth_exceeded() {
        let err = CalcFieldParseError::MaxDepthExceeded { max_depth: 100 };
        let msg = format!("{err}");
        assert!(msg.contains("maximum nesting depth"));
        assert!(msg.contains("100"));
    }

    #[test]
    fn test_display_empty_expression() {
        let err = CalcFieldParseError::EmptyExpression;
        assert_eq!(format!("{err}"), "Empty expression");
    }

    #[test]
    fn test_display_unexpected_token() {
        let err = CalcFieldParseError::UnexpectedToken {
            token: "@".to_string(),
            position: 3,
        };
        let msg = format!("{err}");
        assert!(msg.contains("Unexpected token"));
        assert!(msg.contains("@"));
        assert!(msg.contains("3"));
    }

    // ---- Empty double-quoted field reference ----

    #[test]
    fn test_parse_empty_double_quoted_field() {
        let err = parse_calc_field("\"\" + Revenue").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnexpectedToken { ref token, .. } if token == "\"\""),
            "Error should mention empty double-quoted field: {err}",
        );
    }

    // ---- Unexpected token after paren group ----

    #[test]
    fn test_unexpected_token_after_paren_group() {
        // (A + B) followed by something invalid like another number without operator
        // "(A) B" — after consuming "(A)", parser sees "B" as unconsumed
        let err = parse_calc_field("(A) B").unwrap_err();
        assert!(
            matches!(err, CalcFieldParseError::UnexpectedToken { .. }),
            "Error should be UnexpectedToken: {err}",
        );
    }

    // ---- std::error::Error impl coverage ----

    #[test]
    fn test_error_trait_impl() {
        let err: Box<dyn std::error::Error> = Box::new(CalcFieldParseError::EmptyExpression);
        assert_eq!(err.to_string(), "Empty expression");
    }
}
