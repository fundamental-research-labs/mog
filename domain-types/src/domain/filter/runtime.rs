use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use value_types::CellValue;

use super::advanced::AdvancedFilterState;

/// Filter kind discriminator (AutoFilter vs TableFilter vs AdvancedFilter).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum FilterKind {
    #[default]
    AutoFilter,
    TableFilter,
    AdvancedFilter,
}

/// Column filter criteria — proper tagged enum replacing the stringly-typed ColumnFilterCriteria.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ColumnFilter {
    /// Filter by a set of allowed values.
    #[serde(rename = "values")]
    Values {
        values: Vec<serde_json::Value>,
        #[serde(default, rename = "includeBlanks")]
        include_blanks: bool,
    },
    /// Filter by one or more conditions (AND/OR).
    #[serde(rename = "condition")]
    Condition {
        conditions: Vec<FilterCondition>,
        logic: FilterLogic,
    },
    /// Filter by top/bottom N.
    #[serde(rename = "topBottom")]
    TopBottom {
        direction: TopBottomDirection,
        count: f64,
        by: TopBottomBy,
    },
    /// Filter by a dynamic rule (above average, this month, etc.).
    #[serde(rename = "dynamic")]
    Dynamic { rule: DynamicFilterRule },
    /// Filter by cell or font color.
    #[serde(rename = "color")]
    Color { color: String, by_font: bool },
    /// Filter by conditional-formatting icon.
    ///
    /// Icon evaluation requires CF rule context that the pure compute engine does not
    /// have, so the engine treats Icon filters as all-pass; real filtering happens in
    /// the bridge layer (mirrors `compute_table::types::IconFilter`).
    #[serde(rename = "icon")]
    Icon {
        icon_set_name: String,
        icon_index: u8,
    },
}

/// Logic operator for combining conditions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterLogic {
    And,
    Or,
}

/// A single filter condition with typed operator and value(s).
///
/// Typed OOXML preservation: retyped `value` / `value2` from `Option<serde_json::Value>`
/// to `Option<CellValue>` — runtime filter operands are always scalar
/// cell values, not arbitrary JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    pub operator: FilterOperator,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<CellValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value2: Option<CellValue>,
}

/// Filter comparison operators.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOperator {
    Equals,
    NotEquals,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    BeginsWith,
    EndsWith,
    Contains,
    NotContains,
    Between,
    NotBetween,
    IsBlank,
    IsNotBlank,
    AboveAverage,
    BelowAverage,
}

/// Dynamic filter rule types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DynamicFilterRule {
    AboveAverage,
    BelowAverage,
    Today,
    Yesterday,
    Tomorrow,
    ThisWeek,
    LastWeek,
    NextWeek,
    ThisMonth,
    LastMonth,
    NextMonth,
    ThisQuarter,
    LastQuarter,
    NextQuarter,
    ThisYear,
    LastYear,
    NextYear,
}

/// Direction for top/bottom filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopBottomDirection {
    Top,
    Bottom,
}

/// Basis for top/bottom filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopBottomBy {
    Items,
    Percent,
    Sum,
}

/// Sort configuration for a filter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSortState {
    pub column_cell_id: String,
    pub order: SortOrder,
    pub sort_by: SortBy,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Asc,
    Desc,
}

/// Sort basis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortBy {
    Value,
    Color,
    Icon,
}

/// Position of color-matched rows in a color-based sort.
///
/// When sorting by cell or font color, matched rows can be placed at
/// either the top or bottom of the sorted range. Excel parity: `Top` is
/// the default ("color on top" — matched rows precede unmatched).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ColorPosition {
    #[default]
    Top,
    Bottom,
}

/// Complete filter state for a range (Cell Identity Model).
///
/// This is the ONE canonical representation stored in Yrs.
/// XLSX import transforms AutoFilter -> FilterState.
/// XLSX export transforms FilterState -> AutoFilter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterState {
    pub id: String,
    #[serde(rename = "type")]
    pub filter_kind: FilterKind,
    pub header_start_cell_id: String,
    pub header_end_cell_id: String,
    pub data_end_cell_id: String,
    pub column_filters: HashMap<String, ColumnFilter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advanced_filter: Option<AdvancedFilterState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<FilterSortState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
    // Resolved position fields (populated by engine at runtime, not stored/deserialized)
    #[serde(skip_deserializing, default)]
    pub start_row: Option<u32>,
    #[serde(skip_deserializing, default)]
    pub start_col: Option<u32>,
    #[serde(skip_deserializing, default)]
    pub end_row: Option<u32>,
    #[serde(skip_deserializing, default)]
    pub end_col: Option<u32>,
}

/// Result of evaluating a filter against a single row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterEvaluationResult {
    pub row: u32,
    pub matches: bool,
}

/// Filtered vs total record count for status bar display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilterRecordCount {
    pub visible: usize,
    pub total: usize,
}

/// Information about a filter header cell for UI rendering.
#[derive(Debug, Clone, PartialEq)]
pub struct FilterHeaderInfo {
    pub filter_id: String,
    pub header_cell_id: String,
    pub has_active_filter: bool,
}
