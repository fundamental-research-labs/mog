//! Table engine types — mirrors TypeScript contracts from `table-engine/src/types.ts`.
//!
//! All types derive Serialize/Deserialize with camelCase field names to match
//! the TypeScript wire format. Enum variants use lowercase or camelCase serde rename
//! as appropriate.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use value_types::{CellValue, Color};

// Serde boundary convention:
// - TS `field?: T` (optional) → Rust `Option<T>` with `skip_serializing_if = "Option::is_none"` (omit key)
// - TS `field: T | null` (nullable) → Rust `Option<T>` WITHOUT skip_serializing_if (serialize as null)

// ============================================================================
// Table types — canonical definitions live in domain-types
// ============================================================================

pub use domain_types::domain::table::Table;
pub use domain_types::domain::table::TableColumn;
pub use domain_types::domain::table::TotalsFunction;

/// Type alias for table range (unchanged).
pub type TableRange = cell_types::SheetRange;

/// Boolean table display options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TableBoolOption {
    BandedRows,
    BandedColumns,
    EmphasizeFirstColumn,
    EmphasizeLastColumn,
    ShowFilterButtons,
}

// ============================================================================
// Structured References (defined in compute-types, re-exported here)
// ============================================================================

pub use formula_types::{SpecialItem, StructuredRef, StructuredRefSpecifier};

/// A structural change to a table (for formula rewriting).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TableStructureChange {
    #[serde(rename = "columnRenamed")]
    ColumnRenamed {
        #[serde(rename = "oldName")]
        old_name: String,
        #[serde(rename = "newName")]
        new_name: String,
    },
    #[serde(rename = "tableRenamed")]
    TableRenamed {
        #[serde(rename = "oldName")]
        old_name: String,
        #[serde(rename = "newName")]
        new_name: String,
    },
    #[serde(rename = "columnRemoved")]
    ColumnRemoved { name: String },
    #[serde(rename = "columnAdded")]
    ColumnAdded { name: String, index: u32 },
    #[serde(rename = "tableResized")]
    TableResized {
        #[serde(rename = "oldRange")]
        old_range: TableRange,
        #[serde(rename = "newRange")]
        new_range: TableRange,
    },
}

// ============================================================================
// Filter
// ============================================================================

/// State of all column filters for a table.
/// Named `TableFilterState` to distinguish from the sheet-level `FilterState` in domain_types.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFilterState {
    /// Keyed by table columnId (NOT CellId).
    pub filters: BTreeMap<String, FilterCriteria>,
}

/// A filter criterion — tagged enum discriminated by `type`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FilterCriteria {
    #[serde(rename = "values")]
    Values(ValueFilter),
    #[serde(rename = "condition")]
    Condition(ConditionFilter),
    #[serde(rename = "topBottom")]
    TopBottom(TableTopBottomFilter),
    #[serde(rename = "dynamic")]
    Dynamic(DynamicFilter),
    #[serde(rename = "color")]
    Color(TableColorFilter),
    #[serde(rename = "icon")]
    Icon(IconFilter),
}

/// Filter by a set of allowed values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueFilter {
    /// CellValue[], not serialized strings.
    pub included: Vec<CellValue>,
    pub include_blanks: bool,
}

/// Filter by one or more conditions combined with AND/OR.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionFilter {
    pub conditions: Vec<TableFilterCondition>,
    pub logic: FilterLogic,
}

/// Logic operator for combining multiple filter conditions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterLogic {
    And,
    Or,
}

/// A single filter condition (operator + value(s)).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFilterCondition {
    pub operator: FilterOperator,
    pub value: CellValue,
    /// Second value for `between` / `notBetween` operators.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value2: Option<CellValue>,
}

/// Filter comparison operators.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
}

/// Filter for top/bottom N items, percent, or sum.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableTopBottomFilter {
    pub direction: TopBottomDirection,
    pub count: f64,
    pub by: TopBottomBy,
}

/// Direction for top/bottom filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopBottomDirection {
    Top,
    Bottom,
}

/// Basis for top/bottom filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopBottomBy {
    Items,
    Percent,
    Sum,
}

/// Filter by a dynamic rule (e.g., above average, this month).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicFilter {
    pub rule: DynamicFilterRule,
}

/// Dynamic filter rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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

/// Filter by cell or font color (table-engine variant).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColorFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_color: Option<Color>,
}

/// Filter by conditional formatting icon.
///
/// Like `TableColorFilter`, actual icon evaluation requires CF rule context
/// that the pure filter engine does not have. The Rust engine returns
/// all-visible; real filtering happens in the bridge layer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IconFilter {
    /// The icon set name (e.g. "3Arrows", "4Rating").
    /// Uses String rather than CFIconSetName to avoid a dependency on compute-cf.
    pub icon_set_name: String,
    /// Which icon index within the set to filter for (0-based).
    pub icon_index: u8,
}

/// Data for rendering a filter dropdown in the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterDropdownData {
    pub items: Vec<FilterDropdownItem>,
    pub has_blank: bool,
    pub blank_count: u32,
    pub blank_selected: bool,
    pub total_row_count: u32,
}

/// A single item in a filter dropdown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterDropdownItem {
    pub value: CellValue,
    pub display_text: String,
    pub count: u32,
    pub selected: bool,
}

// ============================================================================
// Sort
// ============================================================================

/// A sort specification for a single column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    pub column_id: String,
    pub direction: SortDirection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_order: Option<Vec<CellValue>>,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Ascending,
    Descending,
}

// --- From conversions: SortOrder (domain-types) <-> SortDirection (compute-table) ---

impl From<domain_types::domain::filter::SortOrder> for SortDirection {
    fn from(order: domain_types::domain::filter::SortOrder) -> Self {
        match order {
            domain_types::domain::filter::SortOrder::Asc => SortDirection::Ascending,
            domain_types::domain::filter::SortOrder::Desc => SortDirection::Descending,
        }
    }
}

impl From<SortDirection> for domain_types::domain::filter::SortOrder {
    fn from(dir: SortDirection) -> Self {
        match dir {
            SortDirection::Ascending => domain_types::domain::filter::SortOrder::Asc,
            SortDirection::Descending => domain_types::domain::filter::SortOrder::Desc,
        }
    }
}

// ============================================================================
// Slicer
// ============================================================================

/// A slicer control connected to a table or pivot table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slicer {
    pub id: String,
    pub name: String,
    pub source_type: SlicerSourceType,
    pub source_id: String,
    /// Table columnId (NOT CellId).
    pub source_column_id: String,
    /// CellValue[], not serialized strings.
    pub selected_values: Vec<CellValue>,
    pub multi_select: bool,
    pub show_items_with_no_data: bool,
    pub sort_order: SlicerSortOrder,
}

/// Source type for a slicer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlicerSourceType {
    Table,
    Pivot,
}

/// Sort order for slicer items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerSortOrder {
    Ascending,
    Descending,
    DataSourceOrder,
}

/// Cached slicer data for rendering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerCache {
    pub items: Vec<SlicerCacheItem>,
    pub total_count: u32,
    pub selected_count: u32,
}

/// A single item in a slicer cache.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerCacheItem {
    pub value: CellValue,
    pub display_text: String,
    pub count: u32,
    pub selected: bool,
    /// False when all rows hidden by OTHER filters.
    pub has_data: bool,
}

// ============================================================================
// Row Visibility
// ============================================================================

/// Bitmap-based row visibility summary.
///
/// `bitmap` has one byte per data row: 1 = visible, 0 = hidden.
/// `first_visible_row` and `last_visible_row` are 0-based relative to
/// the data range start, or `None` if no rows are visible.
///
/// Custom serde: serializes `None` as `-1` for TypeScript compatibility.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowVisibility {
    pub bitmap: Vec<u8>,
    pub visible_count: u32,
    pub total_count: u32,
    #[serde(
        serialize_with = "serialize_option_row",
        deserialize_with = "deserialize_option_row"
    )]
    pub first_visible_row: Option<u32>,
    #[serde(
        serialize_with = "serialize_option_row",
        deserialize_with = "deserialize_option_row"
    )]
    pub last_visible_row: Option<u32>,
}

fn serialize_option_row<S: serde::Serializer>(
    val: &Option<u32>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match val {
        Some(v) => serializer.serialize_i32(*v as i32),
        None => serializer.serialize_i32(-1),
    }
}

fn deserialize_option_row<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u32>, D::Error> {
    let v = i32::deserialize(deserializer)?;
    if v < 0 { Ok(None) } else { Ok(Some(v as u32)) }
}

// ============================================================================
// Table Styles
// ============================================================================

/// Cell formatting within a table style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableCellFormat {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_top: Option<BorderDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_bottom: Option<BorderDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_left: Option<BorderDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_right: Option<BorderDef>,
}

/// A border definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderDef {
    pub style: BorderStyle,
    pub color: Color,
}

/// Border thickness style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BorderStyle {
    Thin,
    Medium,
    Thick,
}

/// A complete table style definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStyleDef {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_font_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_font_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_column_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_column_font_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_column_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_column_font_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odd_row_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub even_row_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odd_col_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub even_col_fill: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_font_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<Color>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellValue, FiniteF64};

    fn round_trip<
        T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
    >(
        val: &T,
    ) {
        let json = serde_json::to_string(val).expect("serialize");
        let back: T = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(*val, back);
    }

    #[test]
    fn test_table_round_trip() {
        let table = Table {
            id: "t1".to_string(),
            name: "Sales".to_string(),
            display_name: "Sales".to_string(),
            sheet_id: "sheet1".to_string(),
            range: TableRange::new(0, 0, 10, 3),
            columns: vec![
                TableColumn {
                    id: "c1".to_string(),
                    name: "Region".to_string(),
                    index: 0,
                    totals_function: Some(TotalsFunction::Count),
                    totals_label: Some("Total".to_string()),
                    calculated_formula: None,
                    ..Default::default()
                },
                TableColumn {
                    id: "c2".to_string(),
                    name: "Amount".to_string(),
                    index: 1,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                    ..Default::default()
                },
            ],
            has_header_row: true,
            has_totals_row: true,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: true,
            show_filter_buttons: true,
            auto_expand: true,
            auto_calculated_columns: true,
            ..Default::default()
        };
        round_trip(&table);

        // Verify camelCase field names in JSON output
        let json = serde_json::to_string(&table).unwrap();
        assert!(json.contains("\"hasHeaderRow\""));
        assert!(json.contains("\"hasTotalsRow\""));
        assert!(json.contains("\"sheetId\""));
        assert!(json.contains("\"bandedRows\""));
        assert!(json.contains("\"emphasizeFirstColumn\""));
        assert!(json.contains("\"showFilterButtons\""));

        // Verify nullable fields serialize as null when None (TS `| null`, not `?:`)
        assert!(json.contains("\"totalsFunction\":null"));
        assert!(json.contains("\"totalsLabel\":null"));
        // And present with value when Some
        assert!(json.contains("\"totalsFunction\":\"count\""));
    }

    #[test]
    fn test_table_range_round_trip() {
        let range = TableRange::new(5, 2, 100, 10);
        round_trip(&range);

        let json = serde_json::to_string(&range).unwrap();
        assert!(json.contains("\"startRow\""));
        assert!(json.contains("\"startCol\""));
        assert!(json.contains("\"endRow\""));
        assert!(json.contains("\"endCol\""));
    }

    #[test]
    fn test_filter_criteria_value_round_trip() {
        let criteria = FilterCriteria::Values(ValueFilter {
            included: vec![
                CellValue::Text("East".into()),
                CellValue::Number(FiniteF64::must(42.0)),
                CellValue::Boolean(true),
            ],
            include_blanks: true,
        });
        round_trip(&criteria);

        // Verify tagged enum serialization with "type" tag
        let json = serde_json::to_string(&criteria).unwrap();
        assert!(json.contains("\"type\":\"values\""));
        assert!(json.contains("\"includeBlanks\":true"));
    }

    #[test]
    fn test_filter_criteria_condition_round_trip() {
        let criteria = FilterCriteria::Condition(ConditionFilter {
            conditions: vec![
                TableFilterCondition {
                    operator: FilterOperator::GreaterThan,
                    value: CellValue::Number(FiniteF64::must(100.0)),
                    value2: None,
                },
                TableFilterCondition {
                    operator: FilterOperator::Between,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    value2: Some(CellValue::Number(FiniteF64::must(50.0))),
                },
                TableFilterCondition {
                    operator: FilterOperator::Contains,
                    value: CellValue::Text("hello".into()),
                    value2: None,
                },
                TableFilterCondition {
                    operator: FilterOperator::IsBlank,
                    value: CellValue::Null,
                    value2: None,
                },
            ],
            logic: FilterLogic::Or,
        });
        round_trip(&criteria);

        let json = serde_json::to_string(&criteria).unwrap();
        assert!(json.contains("\"type\":\"condition\""));
        assert!(json.contains("\"greaterThan\""));
        assert!(json.contains("\"between\""));
        assert!(json.contains("\"contains\""));
        assert!(json.contains("\"isBlank\""));
    }

    #[test]
    fn test_filter_criteria_top_bottom_round_trip() {
        let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 10.0,
            by: TopBottomBy::Items,
        });
        round_trip(&criteria);

        let json = serde_json::to_string(&criteria).unwrap();
        assert!(json.contains("\"type\":\"topBottom\""));
        assert!(json.contains("\"direction\":\"top\""));
        assert!(json.contains("\"by\":\"items\""));

        // Also test bottom + percent
        let criteria2 = FilterCriteria::TopBottom(TableTopBottomFilter {
            direction: TopBottomDirection::Bottom,
            count: 25.0,
            by: TopBottomBy::Percent,
        });
        round_trip(&criteria2);

        // Also test sum
        let criteria3 = FilterCriteria::TopBottom(TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 1000.0,
            by: TopBottomBy::Sum,
        });
        round_trip(&criteria3);
    }

    #[test]
    fn test_filter_criteria_dynamic_round_trip() {
        let rules = vec![
            DynamicFilterRule::AboveAverage,
            DynamicFilterRule::BelowAverage,
            DynamicFilterRule::Today,
            DynamicFilterRule::Yesterday,
            DynamicFilterRule::Tomorrow,
            DynamicFilterRule::ThisWeek,
            DynamicFilterRule::LastWeek,
            DynamicFilterRule::NextWeek,
            DynamicFilterRule::ThisMonth,
            DynamicFilterRule::LastMonth,
            DynamicFilterRule::NextMonth,
            DynamicFilterRule::ThisQuarter,
            DynamicFilterRule::LastQuarter,
            DynamicFilterRule::NextQuarter,
            DynamicFilterRule::ThisYear,
            DynamicFilterRule::LastYear,
            DynamicFilterRule::NextYear,
        ];

        for rule in rules {
            let criteria = FilterCriteria::Dynamic(DynamicFilter { rule });
            round_trip(&criteria);
        }

        let json = serde_json::to_string(&FilterCriteria::Dynamic(DynamicFilter {
            rule: DynamicFilterRule::AboveAverage,
        }))
        .unwrap();
        assert!(json.contains("\"type\":\"dynamic\""));
        assert!(json.contains("\"aboveAverage\""));
    }

    #[test]
    fn test_filter_criteria_icon_round_trip() {
        let criteria = FilterCriteria::Icon(IconFilter {
            icon_set_name: "3Arrows".to_string(),
            icon_index: 2,
        });
        round_trip(&criteria);

        let json = serde_json::to_string(&criteria).unwrap();
        assert!(json.contains("\"type\":\"icon\""));
        assert!(json.contains("\"iconSetName\":\"3Arrows\""));
        assert!(json.contains("\"iconIndex\":2"));
    }

    #[test]
    fn test_filter_state_round_trip() {
        let mut filters = BTreeMap::new();
        filters.insert(
            "col1".to_string(),
            FilterCriteria::Values(ValueFilter {
                included: vec![CellValue::Text("East".into())],
                include_blanks: false,
            }),
        );
        filters.insert(
            "col2".to_string(),
            FilterCriteria::Condition(ConditionFilter {
                conditions: vec![TableFilterCondition {
                    operator: FilterOperator::GreaterThan,
                    value: CellValue::Number(FiniteF64::must(50.0)),
                    value2: None,
                }],
                logic: FilterLogic::And,
            }),
        );
        let state = TableFilterState { filters };
        round_trip(&state);
    }

    #[test]
    fn test_slicer_round_trip() {
        let slicer = Slicer {
            id: "s1".to_string(),
            name: "Region Slicer".to_string(),
            source_type: SlicerSourceType::Table,
            source_id: "table1".to_string(),
            source_column_id: "col1".to_string(),
            selected_values: vec![CellValue::Text("East".into()), CellValue::Null],
            multi_select: true,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::Ascending,
        };
        round_trip(&slicer);

        let json = serde_json::to_string(&slicer).unwrap();
        assert!(json.contains("\"sourceType\":\"table\""));
        assert!(json.contains("\"sourceColumnId\""));
        assert!(json.contains("\"multiSelect\""));
        assert!(json.contains("\"showItemsWithNoData\""));
        assert!(json.contains("\"sortOrder\":\"ascending\""));

        // Test pivot source type
        let slicer_pivot = Slicer {
            source_type: SlicerSourceType::Pivot,
            ..slicer
        };
        round_trip(&slicer_pivot);
        let json2 = serde_json::to_string(&slicer_pivot).unwrap();
        assert!(json2.contains("\"sourceType\":\"pivot\""));
    }

    #[test]
    fn test_row_visibility_round_trip() {
        // Test with Some values
        let vis = RowVisibility {
            bitmap: vec![1, 0, 1, 1],
            visible_count: 3,
            total_count: 4,
            first_visible_row: Some(0),
            last_visible_row: Some(3),
        };
        round_trip(&vis);

        // Also test None case explicitly -- None should serialize as -1
        let vis_none = RowVisibility {
            bitmap: vec![0, 0],
            visible_count: 0,
            total_count: 2,
            first_visible_row: None,
            last_visible_row: None,
        };
        let json = serde_json::to_string(&vis_none).unwrap();
        assert!(json.contains("-1"), "None should serialize as -1");
        round_trip(&vis_none);

        // Verify the Some case does NOT contain -1 for visible rows
        let json_some = serde_json::to_string(&vis).unwrap();
        assert!(json_some.contains("\"firstVisibleRow\":0"));
        assert!(json_some.contains("\"lastVisibleRow\":3"));
    }

    #[test]
    fn test_table_structure_change_round_trip() {
        // ColumnRenamed
        let change = TableStructureChange::ColumnRenamed {
            old_name: "OldCol".to_string(),
            new_name: "NewCol".to_string(),
        };
        round_trip(&change);
        let json = serde_json::to_string(&change).unwrap();
        assert!(json.contains("\"type\":\"columnRenamed\""));
        assert!(json.contains("\"oldName\""));
        assert!(json.contains("\"newName\""));

        // TableRenamed
        let change2 = TableStructureChange::TableRenamed {
            old_name: "OldTable".to_string(),
            new_name: "NewTable".to_string(),
        };
        round_trip(&change2);
        let json2 = serde_json::to_string(&change2).unwrap();
        assert!(json2.contains("\"type\":\"tableRenamed\""));

        // ColumnRemoved
        let change3 = TableStructureChange::ColumnRemoved {
            name: "RemovedCol".to_string(),
        };
        round_trip(&change3);
        let json3 = serde_json::to_string(&change3).unwrap();
        assert!(json3.contains("\"type\":\"columnRemoved\""));

        // ColumnAdded
        let change4 = TableStructureChange::ColumnAdded {
            name: "NewCol".to_string(),
            index: 3,
        };
        round_trip(&change4);
        let json4 = serde_json::to_string(&change4).unwrap();
        assert!(json4.contains("\"type\":\"columnAdded\""));

        // TableResized
        let change5 = TableStructureChange::TableResized {
            old_range: TableRange::new(0, 0, 5, 3),
            new_range: TableRange::new(0, 0, 10, 5),
        };
        round_trip(&change5);
        let json5 = serde_json::to_string(&change5).unwrap();
        assert!(json5.contains("\"type\":\"tableResized\""));
        assert!(json5.contains("\"oldRange\""));
        assert!(json5.contains("\"newRange\""));
    }

    #[test]
    fn test_slicer_cache_round_trip() {
        let cache = SlicerCache {
            items: vec![
                SlicerCacheItem {
                    value: CellValue::Text("East".into()),
                    display_text: "East".to_string(),
                    count: 5,
                    selected: true,
                    has_data: true,
                },
                SlicerCacheItem {
                    value: CellValue::Number(FiniteF64::must(42.0)),
                    display_text: "42".to_string(),
                    count: 2,
                    selected: false,
                    has_data: false,
                },
                SlicerCacheItem {
                    value: CellValue::Null,
                    display_text: "(Blank)".to_string(),
                    count: 1,
                    selected: true,
                    has_data: true,
                },
            ],
            total_count: 3,
            selected_count: 2,
        };
        round_trip(&cache);

        let json = serde_json::to_string(&cache).unwrap();
        assert!(json.contains("\"totalCount\""));
        assert!(json.contains("\"selectedCount\""));
        assert!(json.contains("\"displayText\""));
        assert!(json.contains("\"hasData\""));
    }

    #[test]
    fn test_sort_spec_round_trip() {
        // Without custom_order
        let spec = SortSpec {
            column_id: "col1".to_string(),
            direction: SortDirection::Ascending,
            custom_order: None,
        };
        round_trip(&spec);

        let json = serde_json::to_string(&spec).unwrap();
        assert!(json.contains("\"columnId\""));
        assert!(json.contains("\"direction\":\"ascending\""));
        // custom_order should be skipped when None
        assert!(!json.contains("customOrder"));

        // With custom_order
        let spec2 = SortSpec {
            column_id: "col2".to_string(),
            direction: SortDirection::Descending,
            custom_order: Some(vec![
                CellValue::Text("High".into()),
                CellValue::Text("Medium".into()),
                CellValue::Text("Low".into()),
            ]),
        };
        round_trip(&spec2);

        let json2 = serde_json::to_string(&spec2).unwrap();
        assert!(json2.contains("\"direction\":\"descending\""));
        assert!(json2.contains("\"customOrder\""));
    }

    // ── From conversion tests: SortOrder (domain-types) <-> SortDirection ──

    #[test]
    fn sort_direction_from_domain_sort_order() {
        use domain_types::domain::filter::SortOrder;

        let asc: SortDirection = SortOrder::Asc.into();
        assert_eq!(asc, SortDirection::Ascending);

        let desc: SortDirection = SortOrder::Desc.into();
        assert_eq!(desc, SortDirection::Descending);
    }

    #[test]
    fn domain_sort_order_from_sort_direction() {
        use domain_types::domain::filter::SortOrder;

        let asc: SortOrder = SortDirection::Ascending.into();
        assert_eq!(asc, SortOrder::Asc);

        let desc: SortOrder = SortDirection::Descending.into();
        assert_eq!(desc, SortOrder::Desc);
    }

    #[test]
    fn sort_direction_domain_roundtrip() {
        use domain_types::domain::filter::SortOrder;

        // SortDirection -> SortOrder -> SortDirection
        for dir in [SortDirection::Ascending, SortDirection::Descending] {
            let order: SortOrder = dir.into();
            let back: SortDirection = order.into();
            assert_eq!(dir, back);
        }
    }
}
