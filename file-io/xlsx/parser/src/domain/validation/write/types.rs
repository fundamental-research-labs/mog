// ============================================================================
// Type Definitions
// ============================================================================

/// Data validation rule type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ValidationType {
    /// No validation (default)
    #[default]
    None,
    /// Whole number validation
    Whole,
    /// Decimal number validation
    Decimal,
    /// List (dropdown) validation
    List,
    /// Date validation
    Date,
    /// Time validation
    Time,
    /// Text length validation
    TextLength,
    /// Custom formula validation
    Custom,
}

impl ValidationType {
    /// Convert to XML attribute value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Whole => "whole",
            Self::Decimal => "decimal",
            Self::List => "list",
            Self::Date => "date",
            Self::Time => "time",
            Self::TextLength => "textLength",
            Self::Custom => "custom",
        }
    }
}

/// Validation operator for comparisons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ValidationOperator {
    /// Value must be between formula1 and formula2 (default)
    #[default]
    Between,
    /// Value must NOT be between formula1 and formula2
    NotBetween,
    /// Value must equal formula1
    Equal,
    /// Value must NOT equal formula1
    NotEqual,
    /// Value must be less than formula1
    LessThan,
    /// Value must be less than or equal to formula1
    LessThanOrEqual,
    /// Value must be greater than formula1
    GreaterThan,
    /// Value must be greater than or equal to formula1
    GreaterThanOrEqual,
}

impl ValidationOperator {
    /// Convert to XML attribute value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Between => "between",
            Self::NotBetween => "notBetween",
            Self::Equal => "equal",
            Self::NotEqual => "notEqual",
            Self::LessThan => "lessThan",
            Self::LessThanOrEqual => "lessThanOrEqual",
            Self::GreaterThan => "greaterThan",
            Self::GreaterThanOrEqual => "greaterThanOrEqual",
        }
    }

    /// Check if this operator requires two formulas.
    pub fn requires_formula2(&self) -> bool {
        matches!(self, Self::Between | Self::NotBetween)
    }
}

/// Error style (what happens when invalid data is entered).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ErrorStyle {
    /// Prevents entry (default)
    #[default]
    Stop,
    /// Shows warning, allows entry
    Warning,
    /// Shows info, allows entry
    Information,
}

impl ErrorStyle {
    /// Convert to XML attribute value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::Warning => "warning",
            Self::Information => "information",
        }
    }
}
