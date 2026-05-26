//! Pivot filter types.
//!
//! Consolidated from `pivot-types/src/filter_types.rs`.

use serde::{Deserialize, Serialize};

use super::field::FieldId;
use crate::domain::analytics::PivotFilterConditionFlat;
use value_types::CellValue;

/// Top/Bottom filter type — select the highest or lowest ranked items.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopBottomType {
    /// Select the highest-valued items.
    Top,
    /// Select the lowest-valued items.
    Bottom,
}

/// Top/Bottom ranking basis — how the N value is interpreted.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopBottomBy {
    /// N is a count of items.
    Items,
    /// N is a percentage of total items.
    Percent,
    /// N is a cumulative sum threshold.
    Sum,
}

/// Top/Bottom N filter configuration.
///
/// Selects the top or bottom N items based on aggregated values.
/// For example, "Top 5 by Sum of Sales" or "Bottom 10% by Revenue".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTopBottomFilter {
    /// Whether to select top or bottom items.
    #[serde(rename = "type")]
    pub filter_type: TopBottomType,
    /// The number of items to select (or percentage, depending on `by`).
    ///
    /// Named `n` (not `count`) to avoid ambiguity with "count of matching items".
    /// Accepts the legacy `"count"` field name via serde alias.
    #[serde(alias = "count")]
    pub n: f64,
    /// How to interpret `n`: as a count, percentage, or cumulative sum.
    pub by: TopBottomBy,
    /// Optional value field to rank by. If `None`, uses the first value field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_field_id: Option<FieldId>,
}

/// Complete filter configuration for a field.
///
/// A pivot filter applies to a specific field and can combine multiple filter mechanisms.
/// The composition order is:
///
/// 1. **Include/Exclude lists** — applied first as set operations on unique values
/// 2. **Condition** — applied second as a per-row predicate
/// 3. **Top/Bottom** — applied last (requires aggregated values from prior stages)
///
/// Multiple filter mechanisms can be active simultaneously. For example:
/// - Include only `["East", "West"]` AND where Sales > 100 AND Top 5
///
/// # Important
///
/// `show_items_with_no_data: false` should NOT override an explicit include of `Null`
/// in the `include_values` list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFilter {
    /// The field this filter applies to.
    pub field_id: FieldId,
    /// Values to include (allowlist). Only items matching these values pass.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_values: Option<Vec<CellValue>>,
    /// Values to exclude (denylist). Items matching these values are removed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_values: Option<Vec<CellValue>>,
    /// A predicate condition applied per-row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<PivotFilterConditionFlat>,
    /// Top/bottom N ranking filter (applied after aggregation).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_bottom: Option<PivotTopBottomFilter>,
    /// Whether to show items that have no data in the source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_items_with_no_data: Option<bool>,
}
