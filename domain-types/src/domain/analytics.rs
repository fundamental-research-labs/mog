//! Shared analytical type definitions for the compute engine.
//!
//! These are general-purpose analytical primitives used by both the pivot engine
//! (`compute-pivot`) and worksheet functions (`compute-core`).  They are NOT
//! pivot-specific — any subsystem that needs aggregation, filtering, sorting,
//! or data-type detection should depend on these definitions.
//!
//! Consolidated from `compute-stats/src/types.rs` into `domain-types`.

use serde::{Deserialize, Serialize};

use value_types::CellValue;
// ===========================================================================
// Data type detection
// ===========================================================================
/// Detected data type for a pivot field (column).
///
/// Determined during field detection by scanning source data values.
/// Used to select appropriate grouping, sorting, and filtering strategies.
#[non_exhaustive]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectedDataType {
    /// Text/string values
    String,
    /// Numeric values (including currency, percentages)
    Number,
    /// Date/datetime values (stored as Excel serial numbers)
    Date,
    /// Boolean TRUE/FALSE values
    Boolean,
    /// Column contains no data
    #[default]
    Empty,
    /// Column contains error values
    Error,
}

// ===========================================================================
// Aggregation
// ===========================================================================
/// Aggregation functions available for value fields.
///
/// Each variant corresponds to an Excel pivot table aggregation function.
/// The serde rename ensures wire-format compatibility with TypeScript.
///
/// # Naming Convention
///
/// Variant names use `PascalCase` with proper casing (e.g., `CountA`, `StdDev`).
/// The `#[serde(rename)]` attributes map to the lowercase TypeScript names.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AggregateFunction {
    /// SUM — sum of numeric values
    Sum,
    /// COUNT — count of numeric values
    Count,
    /// COUNTA — count of non-empty values
    #[serde(rename = "counta")]
    CountA,
    /// COUNTUNIQUE — count of unique non-empty values
    #[serde(rename = "countunique")]
    CountUnique,
    /// AVERAGE — arithmetic mean of numeric values
    Average,
    /// MIN — minimum numeric value
    Min,
    /// MAX — maximum numeric value
    Max,
    /// PRODUCT — product of numeric values
    Product,
    /// STDEV — sample standard deviation
    #[serde(rename = "stdev")]
    StdDev,
    /// STDEVP — population standard deviation
    #[serde(rename = "stdevp")]
    StdDevP,
    /// VAR — sample variance
    Var,
    /// VARP — population variance
    #[serde(rename = "varp")]
    VarP,
}

// ===========================================================================
// Sorting
// ===========================================================================
/// Sort direction for row/column fields.
///
/// Only two variants: `Asc` and `Desc`. There is no `None` variant — use
/// `Option<SortDirection>` when "no sort" is a valid state.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    /// Ascending order (A-Z, 0-9, oldest-newest)
    #[default]
    Asc,
    /// Descending order (Z-A, 9-0, newest-oldest)
    Desc,
}

// ===========================================================================
// Date grouping
// ===========================================================================
/// Date grouping options for row/column axis fields.
///
/// When applied to a date field, values are grouped by the specified unit.
/// Multiple levels of date grouping can be achieved by placing the same field
/// in multiple row/column positions with different groupings.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DateGrouping {
    /// Group by year (e.g., 2024, 2025)
    Year,
    /// Group by quarter (Q1, Q2, Q3, Q4)
    Quarter,
    /// Group by month name (January, February, ...)
    Month,
    /// Group by ISO week number
    Week,
    /// Group by day
    Day,
    /// Group by hour (0-23)
    Hour,
    /// Group by minute (0-59)
    Minute,
    /// Group by second (0-59)
    Second,
}

// ===========================================================================
// Number grouping
// ===========================================================================
/// Number grouping configuration for row/column axis fields.
///
/// Groups numeric values into equal-width buckets (bins). For example,
/// `{ start: 0, end: 100, interval: 10 }` creates bins \[0,10), \[10,20), ..., \[90,100\].
///
/// # Validation
///
/// Use [`NumberGrouping::validate()`] to check for degenerate configurations
/// before using. The `validate()` method rejects:
/// - `interval <= 0`
/// - `end <= start`
/// - NaN or Infinity in any field
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberGrouping {
    /// Lower bound of the grouping range (inclusive).
    pub start: f64,
    /// Upper bound of the grouping range (inclusive).
    pub end: f64,
    /// Width of each bucket.
    pub interval: f64,
}

impl NumberGrouping {
    /// Create a new `NumberGrouping` with the given range and bucket width.
    #[must_use]
    pub fn new(start: f64, end: f64, interval: f64) -> Self {
        Self {
            start,
            end,
            interval,
        }
    }

    /// Validate that this grouping configuration is well-formed.
    ///
    /// Returns `Ok(())` if valid, or `Err` with a description of the problem.
    ///
    /// # Errors
    ///
    /// Returns `Err(String)` if:
    /// - `interval <= 0.0` — buckets must have positive width
    /// - `end <= start` — range must be non-empty
    /// - Any field is NaN or Infinity — must be finite values
    pub fn validate(&self) -> Result<(), String> {
        if !self.start.is_finite() {
            return Err("NumberGrouping.start must be finite".to_string());
        }
        if !self.end.is_finite() {
            return Err("NumberGrouping.end must be finite".to_string());
        }
        if !self.interval.is_finite() {
            return Err("NumberGrouping.interval must be finite".to_string());
        }
        if self.interval <= 0.0 {
            return Err(format!(
                "NumberGrouping.interval must be positive, got {}",
                self.interval
            ));
        }
        if self.end <= self.start {
            return Err(format!(
                "NumberGrouping.end ({}) must be greater than start ({})",
                self.end, self.start
            ));
        }
        Ok(())
    }
}

// ===========================================================================
// Filter operator
// ===========================================================================
/// Filter operator types.
///
/// Required for [`PivotFilterConditionFlat`] serde compatibility.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOperator {
    /// Match equal values.
    Equals,
    /// Match non-equal values.
    NotEquals,
    /// Match text containing a substring.
    Contains,
    /// Match text not containing a substring.
    NotContains,
    /// Match text starting with a prefix.
    StartsWith,
    /// Match text ending with a suffix.
    EndsWith,
    /// Match values greater than threshold.
    GreaterThan,
    /// Match values >= threshold.
    GreaterThanOrEqual,
    /// Match values less than threshold.
    LessThan,
    /// Match values <= threshold.
    LessThanOrEqual,
    /// Match values in a range (inclusive).
    Between,
    /// Match values outside a range.
    NotBetween,
    /// Match blank/empty cells.
    IsBlank,
    /// Match non-blank cells.
    IsNotBlank,
    /// Match values above the field average.
    AboveAverage,
    /// Match values below the field average.
    BelowAverage,
}

// ===========================================================================
// Filter operator enums (by arity)
// ===========================================================================

/// Operators that take no operands (nullary / zero-arity).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NullaryFilterOp {
    /// Match blank/empty cells.
    IsBlank,
    /// Match non-blank cells.
    IsNotBlank,
    /// Match cells with values above the field average.
    AboveAverage,
    /// Match cells with values below the field average.
    BelowAverage,
}

/// Operators that take one operand (unary / single-arity).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum UnaryFilterOp {
    /// Match equal values.
    Equals,
    /// Match non-equal values.
    NotEquals,
    /// Match values greater than threshold.
    GreaterThan,
    /// Match values less than threshold.
    LessThan,
    /// Match values >= threshold.
    GreaterThanOrEqual,
    /// Match values <= threshold.
    LessThanOrEqual,
    /// Match text containing a substring.
    Contains,
    /// Match text not containing a substring.
    NotContains,
    /// Match text starting with a prefix.
    StartsWith,
    /// Match text ending with a suffix.
    EndsWith,
}

/// Operators that take two operands (binary / two-arity).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BinaryFilterOp {
    /// Match values in a range (inclusive).
    Between,
    /// Match values outside a range.
    NotBetween,
}

// ===========================================================================
// Filter condition (type-safe enum, structured by arity)
// ===========================================================================
/// Type-safe filter condition — operand counts are enforced by the enum structure.
///
/// Three variants group operators by how many operands they require:
/// - **Nullary** (no operands): `IsBlank`, `IsNotBlank`, `AboveAverage`, `BelowAverage`
/// - **Unary** (one operand): `Equals`, `Contains`, `GreaterThan`, etc.
/// - **Binary** (two operands): `Between`, `NotBetween`
///
/// This replaces the old flat `{ operator, value, value2 }` struct where
/// `Between` with a missing `value2` was representable but invalid.
///
/// # Serde
///
/// Uses `#[serde(tag = "operator", rename_all = "camelCase")]` for JSON like:
/// ```json
/// {"operator": "nullary", "op": "IsBlank"}
/// {"operator": "unary", "op": "Equals", "value": {"type": "Number", "value": 42}}
/// {"operator": "binary", "op": "Between", "value": {"type": "Number", "value": 10}, "value2": {"type": "Number", "value": 20}}
/// ```
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "operator", rename_all = "camelCase")]
pub enum PivotFilterCondition {
    /// A filter condition with no operands.
    Nullary(NullaryFilterOp),
    /// A filter condition with one operand.
    Unary {
        /// The unary operator.
        op: UnaryFilterOp,
        /// The value to compare against.
        value: CellValue,
    },
    /// A filter condition with two operands.
    Binary {
        /// The binary operator.
        op: BinaryFilterOp,
        /// First operand (e.g., lower bound).
        value: CellValue,
        /// Second operand (e.g., upper bound).
        value2: CellValue,
    },
}

// ===========================================================================
// Filter condition (flat / legacy serde)
// ===========================================================================
/// Legacy flat filter condition for serde compatibility with TypeScript contracts.
///
/// Use `PivotFilterCondition::from_flat(flat)` to convert to the type-safe representation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFilterConditionFlat {
    /// The filter operator.
    pub operator: FilterOperator,
    /// First operand (required for binary/ternary operators).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<CellValue>,
    /// Second operand (required for Between/NotBetween).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value2: Option<CellValue>,
}

impl PivotFilterCondition {
    /// Convert from the flat serde representation, filling missing operands with `CellValue::Null`.
    ///
    /// This accepts the legacy `{ operator, value, value2 }` format from TypeScript
    /// and produces the type-safe enum variant.  Missing operands are filled with
    /// `CellValue::Null` rather than returning an error, because upstream validation
    /// (e.g., `validate_and_resolve()`) is responsible for rejecting incomplete filters.
    #[must_use]
    pub fn from_flat(flat: PivotFilterConditionFlat) -> Self {
        match flat.operator {
            FilterOperator::IsBlank => PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank),
            FilterOperator::IsNotBlank => {
                PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank)
            }
            FilterOperator::AboveAverage => {
                PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage)
            }
            FilterOperator::BelowAverage => {
                PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage)
            }
            FilterOperator::Equals => PivotFilterCondition::Unary {
                op: UnaryFilterOp::Equals,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::NotEquals => PivotFilterCondition::Unary {
                op: UnaryFilterOp::NotEquals,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::GreaterThan => PivotFilterCondition::Unary {
                op: UnaryFilterOp::GreaterThan,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::LessThan => PivotFilterCondition::Unary {
                op: UnaryFilterOp::LessThan,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::GreaterThanOrEqual => PivotFilterCondition::Unary {
                op: UnaryFilterOp::GreaterThanOrEqual,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::LessThanOrEqual => PivotFilterCondition::Unary {
                op: UnaryFilterOp::LessThanOrEqual,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::Contains => PivotFilterCondition::Unary {
                op: UnaryFilterOp::Contains,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::NotContains => PivotFilterCondition::Unary {
                op: UnaryFilterOp::NotContains,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::StartsWith => PivotFilterCondition::Unary {
                op: UnaryFilterOp::StartsWith,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::EndsWith => PivotFilterCondition::Unary {
                op: UnaryFilterOp::EndsWith,
                value: flat.value.unwrap_or(CellValue::Null),
            },
            FilterOperator::Between => PivotFilterCondition::Binary {
                op: BinaryFilterOp::Between,
                value: flat.value.unwrap_or(CellValue::Null),
                value2: flat.value2.unwrap_or(CellValue::Null),
            },
            FilterOperator::NotBetween => PivotFilterCondition::Binary {
                op: BinaryFilterOp::NotBetween,
                value: flat.value.unwrap_or(CellValue::Null),
                value2: flat.value2.unwrap_or(CellValue::Null),
            },
        }
    }
}

impl From<PivotFilterCondition> for PivotFilterConditionFlat {
    fn from(typed: PivotFilterCondition) -> Self {
        match typed {
            PivotFilterCondition::Nullary(op) => {
                let operator = match op {
                    NullaryFilterOp::IsBlank => FilterOperator::IsBlank,
                    NullaryFilterOp::IsNotBlank => FilterOperator::IsNotBlank,
                    NullaryFilterOp::AboveAverage => FilterOperator::AboveAverage,
                    NullaryFilterOp::BelowAverage => FilterOperator::BelowAverage,
                };
                PivotFilterConditionFlat {
                    operator,
                    value: None,
                    value2: None,
                }
            }
            PivotFilterCondition::Unary { op, value } => {
                let operator = match op {
                    UnaryFilterOp::Equals => FilterOperator::Equals,
                    UnaryFilterOp::NotEquals => FilterOperator::NotEquals,
                    UnaryFilterOp::GreaterThan => FilterOperator::GreaterThan,
                    UnaryFilterOp::LessThan => FilterOperator::LessThan,
                    UnaryFilterOp::GreaterThanOrEqual => FilterOperator::GreaterThanOrEqual,
                    UnaryFilterOp::LessThanOrEqual => FilterOperator::LessThanOrEqual,
                    UnaryFilterOp::Contains => FilterOperator::Contains,
                    UnaryFilterOp::NotContains => FilterOperator::NotContains,
                    UnaryFilterOp::StartsWith => FilterOperator::StartsWith,
                    UnaryFilterOp::EndsWith => FilterOperator::EndsWith,
                };
                PivotFilterConditionFlat {
                    operator,
                    value: Some(value),
                    value2: None,
                }
            }
            PivotFilterCondition::Binary { op, value, value2 } => {
                let operator = match op {
                    BinaryFilterOp::Between => FilterOperator::Between,
                    BinaryFilterOp::NotBetween => FilterOperator::NotBetween,
                };
                PivotFilterConditionFlat {
                    operator,
                    value: Some(value),
                    value2: Some(value2),
                }
            }
        }
    }
}
