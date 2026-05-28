// ============================================================================
// TableFormula -- CT_TableFormula
// ============================================================================

/// Table formula with array flag (CT_TableFormula).
///
/// Wraps a formula string with an optional `array` attribute indicating
/// whether the formula is an array formula. Used for `calculatedColumnFormula`
/// and `totalsRowFormula` in CT_TableColumn.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct TableFormula {
    /// The formula text content.
    pub text: String,
    /// Whether this is an array formula. Default: `false`.
    pub array: bool,
}

impl TableFormula {
    /// Create a new simple (non-array) table formula.
    #[must_use]
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            array: false,
        }
    }

    /// Create a new array table formula.
    #[must_use]
    pub fn new_array(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            array: true,
        }
    }
}
