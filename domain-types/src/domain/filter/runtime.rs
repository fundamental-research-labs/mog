use std::collections::{BTreeMap, HashMap};

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
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum FilterCapability {
    #[default]
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportFilterUnsupportedReason {
    UnknownDynamicType,
    UnknownCustomOperator,
    DateGroupUnsupported,
    DynamicTemporalContextUnsupported,
    ValueTokenUnresolved,
    ValueTypeUnsupported,
    ColorDxfUnresolved,
    IconFilterUnsupported,
    UnknownExtension,
    TableFilterShapeUnsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterButtonMetadata {
    pub header_cell_id: String,
    pub col_id: u32,
    pub hidden_button: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_button: Option<bool>,
    pub button_visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LosslessCriterionDescriptor {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_col_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_column_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_column_ordinal: Option<u32>,
    pub kind: String,
    pub preserved_json: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterShellMetadata {
    pub capability: FilterCapability,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unsupported_reasons: Vec<ImportFilterUnsupportedReason>,
    pub has_active_lossless_criteria: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub button_metadata: BTreeMap<String, FilterButtonMetadata>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lossless_criteria: Vec<LosslessCriterionDescriptor>,
}

impl Default for FilterShellMetadata {
    fn default() -> Self {
        Self {
            capability: FilterCapability::Supported,
            unsupported_reasons: Vec::new(),
            has_active_lossless_criteria: false,
            button_metadata: BTreeMap::new(),
            lossless_criteria: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum FilterMetadataOwnerPath {
    SheetAutoFilter { sheet_id: String },
    TableAutoFilter { sheet_id: String, table_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum FilterMetadataSourceKey {
    SheetAutoFilter {
        sheet_id: String,
        range_ref: String,
    },
    TableAutoFilter {
        sheet_id: String,
        table_id: String,
        table_name: String,
        range_ref: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterMetadataBinding {
    pub filter_id: String,
    pub filter_kind: FilterKind,
    pub sheet_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
    pub owner_path: FilterMetadataOwnerPath,
    pub source_key: FilterMetadataSourceKey,
    pub range_ref: String,
    pub header_start_cell_id: String,
    pub header_end_cell_id: String,
    pub data_end_cell_id: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub col_id_to_header_cell_id: BTreeMap<u32, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub table_column_id_to_header_cell_id: BTreeMap<String, String>,
    pub shell: FilterShellMetadata,
    pub source_fingerprint: String,
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

/// Resolved filter range for UI header rendering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterHeaderRange {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterHeaderSourceType {
    SheetAutoFilter,
    TableAutoFilter,
}

/// Information about a filter header cell for UI rendering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterHeaderInfo {
    pub filter_id: String,
    pub header_cell_id: String,
    pub has_active_filter: bool,
    pub row: u32,
    pub col: u32,
    pub filter_kind: FilterKind,
    pub range: FilterHeaderRange,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
    pub source_type: FilterHeaderSourceType,
    pub capability: FilterCapability,
    pub unsupported_reasons: Vec<ImportFilterUnsupportedReason>,
    pub button_visible: bool,
    pub hidden_button: bool,
    pub show_button: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_metadata_binding_serializes_canonical_shell_fields() {
        let mut col_id_to_header_cell_id = BTreeMap::new();
        col_id_to_header_cell_id.insert(2, "cell-b".to_string());
        let mut button_metadata = BTreeMap::new();
        button_metadata.insert(
            "cell-b".to_string(),
            FilterButtonMetadata {
                header_cell_id: "cell-b".to_string(),
                col_id: 2,
                hidden_button: true,
                show_button: Some(false),
                button_visible: false,
            },
        );
        let binding = FilterMetadataBinding {
            filter_id: "filter-1".to_string(),
            filter_kind: FilterKind::AutoFilter,
            sheet_id: "sheet-1".to_string(),
            table_id: None,
            owner_path: FilterMetadataOwnerPath::SheetAutoFilter {
                sheet_id: "sheet-1".to_string(),
            },
            source_key: FilterMetadataSourceKey::SheetAutoFilter {
                sheet_id: "sheet-1".to_string(),
                range_ref: "A1:D12".to_string(),
            },
            range_ref: "A1:D12".to_string(),
            header_start_cell_id: "cell-a".to_string(),
            header_end_cell_id: "cell-d".to_string(),
            data_end_cell_id: "cell-d12".to_string(),
            col_id_to_header_cell_id,
            table_column_id_to_header_cell_id: BTreeMap::new(),
            shell: FilterShellMetadata {
                capability: FilterCapability::Unsupported,
                unsupported_reasons: vec![
                    ImportFilterUnsupportedReason::IconFilterUnsupported,
                    ImportFilterUnsupportedReason::ValueTokenUnresolved,
                ],
                has_active_lossless_criteria: true,
                button_metadata,
                lossless_criteria: vec![LosslessCriterionDescriptor {
                    filter_col_id: Some(2),
                    table_column_id: None,
                    table_column_ordinal: None,
                    kind: "icon".to_string(),
                    preserved_json: serde_json::json!({ "iconSet": "3TrafficLights1" }),
                }],
            },
            source_fingerprint: "filterMetadataBindingFingerprintV1:test".to_string(),
        };

        let json = serde_json::to_value(&binding).unwrap();

        assert_eq!(json["filterKind"], "autoFilter");
        assert_eq!(json["ownerPath"]["kind"], "sheetAutoFilter");
        assert_eq!(json["sourceKey"]["rangeRef"], "A1:D12");
        assert_eq!(json["shell"]["capability"], "unsupported");
        assert_eq!(
            json["shell"]["unsupportedReasons"],
            serde_json::json!(["iconFilterUnsupported", "valueTokenUnresolved"])
        );
        assert_eq!(
            json["shell"]["buttonMetadata"]["cell-b"]["buttonVisible"],
            false
        );
    }
}
