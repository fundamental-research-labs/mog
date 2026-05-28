use std::fmt;

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
