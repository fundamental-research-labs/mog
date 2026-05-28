use value_types::CellError;

use crate::ast::ASTNode;
use crate::parser::parse_formula;

/// A parsed formula paired with its original source bytes.
///
/// Both fields are load-bearing:
///
/// - `ast`: the parsed [`ASTNode`] -- may be an error-recovery node when the
///   input is malformed.
/// - `original`: the raw input bytes, preserved verbatim. XLSX writers emit
///   this string directly for round-trip fidelity.
///
/// # Equality
///
/// [`PartialEq`] compares only `original`. Two `FormulaSource` values with the
/// same source bytes are functionally equivalent; the AST is a deterministic
/// function of the source.
#[derive(Debug, Clone)]
pub struct FormulaSource {
    /// Parsed AST -- may be an error-recovery node for malformed input.
    pub ast: ASTNode,
    /// Original source bytes, preserved verbatim.
    pub original: String,
}

impl FormulaSource {
    /// Parse an arbitrary formula string.
    ///
    /// Totality: never returns an error. When [`parse_formula`] fails, the
    /// returned `ast` is an [`ASTNode::Error`] sentinel carrying `#N/A`; the
    /// original bytes are preserved verbatim in `original` so the writer path
    /// can still emit the author's text untouched.
    #[must_use]
    pub fn parse(input: &str) -> Self {
        let ast = match parse_formula(input, None) {
            Ok(spanned) => spanned.into_inner(),
            Err(_) => ASTNode::Error(CellError::Na),
        };
        Self {
            ast,
            original: input.to_string(),
        }
    }
}

impl PartialEq for FormulaSource {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.original == other.original
    }
}

impl Eq for FormulaSource {}
