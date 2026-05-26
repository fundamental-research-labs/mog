//! Show-values-as configuration types.
//!
//! Consolidated from `pivot-types/src/show_values_as.rs`.

use serde::{Deserialize, Serialize};

use super::field::FieldId;
use crate::domain::analytics::SortDirection;
use value_types::CellValue;

/// "Show Values As" calculation types — post-aggregation transforms.
///
/// These transforms modify how aggregated values are displayed without changing
/// the underlying aggregation. For example, `PercentOfGrandTotal` divides each
/// cell's aggregated value by the grand total.
///
/// # Base Field and Base Item Requirements
///
/// Some variants require `base_field` and/or `base_item` in [`ShowValuesAsConfig`]:
///
/// | Variant | `base_field` | `base_item` |
/// |---------|-------------|-------------|
/// | `NoCalculation` | - | - |
/// | `PercentOfGrandTotal` | - | - |
/// | `PercentOfColumnTotal` | - | - |
/// | `PercentOfRowTotal` | - | - |
/// | `PercentOfParentRowTotal` | Optional (defaults to innermost) | - |
/// | `PercentOfParentColumnTotal` | Optional (defaults to innermost) | - |
/// | `Difference` | **Required** | **Required** |
/// | `PercentDifference` | **Required** | **Required** |
/// | `RunningTotal` | **Required** | - |
/// | `PercentRunningTotal` | **Required** | - |
/// | `RankAscending` | **Required** | - |
/// | `RankDescending` | **Required** | - |
/// | `Index` | - | - |
#[non_exhaustive]
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShowValuesAs {
    /// No calculation — show raw aggregated values.
    #[default]
    NoCalculation,
    /// Each value as a percentage of the grand total.
    PercentOfGrandTotal,
    /// Each value as a percentage of its column total.
    PercentOfColumnTotal,
    /// Each value as a percentage of its row total.
    PercentOfRowTotal,
    /// Each value as a percentage of its parent row's total.
    PercentOfParentRowTotal,
    /// Each value as a percentage of its parent column's total.
    PercentOfParentColumnTotal,
    /// Difference from a base item in a base field.
    Difference,
    /// Percentage difference from a base item in a base field.
    PercentDifference,
    /// Cumulative running total across a base field.
    RunningTotal,
    /// Cumulative running total as a percentage of the field total.
    PercentRunningTotal,
    /// Rank from smallest to largest within a base field.
    RankAscending,
    /// Rank from largest to smallest within a base field.
    RankDescending,
    /// Index calculation: `(cell_value * grand_total) / (row_total * column_total)`.
    Index,
}

/// Direction for base item navigation in Show Values As.
///
/// Used with [`ShowValuesAsBaseItem::Relative`] to reference the previous or next
/// item in the base field's sort order.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelativePosition {
    /// The item immediately before the current item in sort order.
    Previous,
    /// The item immediately after the current item in sort order.
    Next,
}

/// Base item reference for Show Values As transforms.
///
/// Specifies which item to compare against for `Difference`, `PercentDifference`,
/// and similar calculations.
///
/// # Serde Format
///
/// Uses internally-tagged representation:
/// - Relative: `{"type": "relative", "position": "previous"}`
/// - Specific: `{"type": "specific", "value": {"type": "Text", "value": "Widget"}}`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ShowValuesAsBaseItem {
    /// Compare to the previous or next item in sort order.
    Relative {
        /// Which direction to navigate.
        position: RelativePosition,
    },
    /// Compare to a specific item by its value.
    Specific {
        /// The value to compare against.
        value: CellValue,
    },
}

/// Configuration for "Show Values As" calculations.
///
/// Combines the calculation type with optional base field and base item references.
/// See [`ShowValuesAs`] for which variants require which fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowValuesAsConfig {
    /// The type of calculation to apply.
    #[serde(rename = "type")]
    pub calculation_type: ShowValuesAs,
    /// The field to use as the base for comparisons (e.g., "Region").
    /// Required for Difference, `PercentDifference`, `RunningTotal`, etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_field: Option<FieldId>,
    /// The specific item or relative position to compare against.
    /// Required for Difference and `PercentDifference`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_item: Option<ShowValuesAsBaseItem>,
}

/// Configuration for sorting by aggregated values instead of labels.
///
/// When applied to a row or column axis field, items are sorted by the aggregated
/// value of a specific value field rather than alphabetically by label.
///
/// For example, sorting regions by total sales (descending) to show the highest-
/// revenue region first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortByValueConfig {
    /// The value field whose aggregated values determine sort order.
    pub value_field_id: FieldId,
    /// Sort direction (Asc or Desc). Always required for sort-by-value.
    pub order: SortDirection,
    /// Optional column leaf key to sort by a specific column's values.
    ///
    /// In a pivot with column fields, each row has multiple aggregated values
    /// (one per column leaf). This key specifies which column leaf's value to use
    /// for sorting. If `None`, uses the first column leaf (or grand total if no columns).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_key: Option<String>,
}
