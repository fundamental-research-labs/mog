//! Pivot table layout, format, and area types (ECMA-376 §18.10 — pivot formats).
//!
//! Covers `<formats>`, `<conditionalFormats>`, `<chartFormats>`, `<filters>`,
//! `<pivotArea>`, and the axis/area/scope/filter-type enums.

// ============================================================================
// PivotFormatAction — ST_FormatAction
// ============================================================================

/// Format action type for pivot table formats (ST_FormatAction).
///
/// Specifies what kind of action a pivot format applies to.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PivotFormatAction {
    /// Blank cells.
    #[xml("blank")]
    Blank,
    /// Cell formatting (default).
    #[default]
    #[xml("formatting")]
    Formatting,
    /// Drill operation.
    #[xml("drill")]
    Drill,
    /// Formula-based formatting.
    #[xml("formula")]
    Formula,
}

// ============================================================================
// PivotAreaType — ST_PivotAreaType
// ============================================================================

/// Pivot area type (ST_PivotAreaType, §18.18.62).
///
/// Specifies the type of pivot table area being referenced.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PivotAreaType {
    /// No specific area type.
    #[default]
    #[xml("none")]
    None,
    /// Normal data area.
    #[xml("normal")]
    Normal,
    /// Data values area.
    #[xml("data")]
    Data,
    /// All areas.
    #[xml("all")]
    All,
    /// Origin area.
    #[xml("origin")]
    Origin,
    /// Field button area.
    #[xml("button")]
    Button,
    /// Top-end area.
    #[xml("topEnd")]
    TopEnd,
    /// Top-right area.
    #[xml("topRight")]
    TopRight,
}

// ============================================================================
// PivotFilterType — ST_PivotFilterType
// ============================================================================

/// Pivot filter type (ST_PivotFilterType, §18.18.63).
///
/// Specifies the type of filter applied to a pivot table field.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PivotFilterType {
    /// Unknown filter type (default).
    #[default]
    #[xml("unknown")]
    Unknown,
    /// Top/bottom count filter.
    #[xml("count")]
    Count,
    /// Top/bottom percent filter.
    #[xml("percent")]
    Percent,
    /// Top/bottom sum filter.
    #[xml("sum")]
    Sum,
    /// Caption equals.
    #[xml("captionEqual")]
    CaptionEqual,
    /// Caption does not equal.
    #[xml("captionNotEqual")]
    CaptionNotEqual,
    /// Caption begins with.
    #[xml("captionBeginsWith")]
    CaptionBeginsWith,
    /// Caption does not begin with.
    #[xml("captionNotBeginsWith")]
    CaptionNotBeginsWith,
    /// Caption ends with.
    #[xml("captionEndsWith")]
    CaptionEndsWith,
    /// Caption does not end with.
    #[xml("captionNotEndsWith")]
    CaptionNotEndsWith,
    /// Caption contains.
    #[xml("captionContains")]
    CaptionContains,
    /// Caption does not contain.
    #[xml("captionNotContains")]
    CaptionNotContains,
    /// Caption greater than.
    #[xml("captionGreaterThan")]
    CaptionGreaterThan,
    /// Caption greater than or equal.
    #[xml("captionGreaterThanOrEqual")]
    CaptionGreaterThanOrEqual,
    /// Caption less than.
    #[xml("captionLessThan")]
    CaptionLessThan,
    /// Caption less than or equal.
    #[xml("captionLessThanOrEqual")]
    CaptionLessThanOrEqual,
    /// Caption between.
    #[xml("captionBetween")]
    CaptionBetween,
    /// Caption not between.
    #[xml("captionNotBetween")]
    CaptionNotBetween,
    /// Value equals.
    #[xml("valueEqual")]
    ValueEqual,
    /// Value does not equal.
    #[xml("valueNotEqual")]
    ValueNotEqual,
    /// Value greater than.
    #[xml("valueGreaterThan")]
    ValueGreaterThan,
    /// Value greater than or equal.
    #[xml("valueGreaterThanOrEqual")]
    ValueGreaterThanOrEqual,
    /// Value less than.
    #[xml("valueLessThan")]
    ValueLessThan,
    /// Value less than or equal.
    #[xml("valueLessThanOrEqual")]
    ValueLessThanOrEqual,
    /// Value between.
    #[xml("valueBetween")]
    ValueBetween,
    /// Value not between.
    #[xml("valueNotBetween")]
    ValueNotBetween,
    /// Date equals.
    #[xml("dateEqual")]
    DateEqual,
    /// Date does not equal.
    #[xml("dateNotEqual")]
    DateNotEqual,
    /// Date older than.
    #[xml("dateOlderThan")]
    DateOlderThan,
    /// Date older than or equal.
    #[xml("dateOlderThanOrEqual")]
    DateOlderThanOrEqual,
    /// Date newer than.
    #[xml("dateNewerThan")]
    DateNewerThan,
    /// Date newer than or equal.
    #[xml("dateNewerThanOrEqual")]
    DateNewerThanOrEqual,
    /// Date between.
    #[xml("dateBetween")]
    DateBetween,
    /// Date not between.
    #[xml("dateNotBetween")]
    DateNotBetween,
    /// Tomorrow.
    #[xml("tomorrow")]
    Tomorrow,
    /// Today.
    #[xml("today")]
    Today,
    /// Yesterday.
    #[xml("yesterday")]
    Yesterday,
    /// This week.
    #[xml("thisWeek")]
    ThisWeek,
    /// Last week.
    #[xml("lastWeek")]
    LastWeek,
    /// Next week.
    #[xml("nextWeek")]
    NextWeek,
    /// This month.
    #[xml("thisMonth")]
    ThisMonth,
    /// Last month.
    #[xml("lastMonth")]
    LastMonth,
    /// Next month.
    #[xml("nextMonth")]
    NextMonth,
    /// This quarter.
    #[xml("thisQuarter")]
    ThisQuarter,
    /// Last quarter.
    #[xml("lastQuarter")]
    LastQuarter,
    /// Next quarter.
    #[xml("nextQuarter")]
    NextQuarter,
    /// This year.
    #[xml("thisYear")]
    ThisYear,
    /// Last year.
    #[xml("lastYear")]
    LastYear,
    /// Next year.
    #[xml("nextYear")]
    NextYear,
    /// Year to date.
    #[xml("yearToDate")]
    YearToDate,
    /// Quarter 1.
    #[xml("Q1")]
    Q1,
    /// Quarter 2.
    #[xml("Q2")]
    Q2,
    /// Quarter 3.
    #[xml("Q3")]
    Q3,
    /// Quarter 4.
    #[xml("Q4")]
    Q4,
    /// January.
    #[xml("M1")]
    M1,
    /// February.
    #[xml("M2")]
    M2,
    /// March.
    #[xml("M3")]
    M3,
    /// April.
    #[xml("M4")]
    M4,
    /// May.
    #[xml("M5")]
    M5,
    /// June.
    #[xml("M6")]
    M6,
    /// July.
    #[xml("M7")]
    M7,
    /// August.
    #[xml("M8")]
    M8,
    /// September.
    #[xml("M9")]
    M9,
    /// October.
    #[xml("M10")]
    M10,
    /// November.
    #[xml("M11")]
    M11,
    /// December.
    #[xml("M12")]
    M12,
}

// ============================================================================
// PivotScope — ST_Scope
// ============================================================================

/// Pivot scope for conditional formatting (ST_Scope, §18.18.67).
///
/// Specifies the scope of a pivot table conditional formatting rule.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PivotScope {
    /// Selection scope (default).
    #[default]
    #[xml("selection")]
    Selection,
    /// Data scope.
    #[xml("data")]
    Data,
    /// Field scope.
    #[xml("field")]
    Field,
}

// ============================================================================
// PivotSortType — ST_SortType (pivot-specific)
// ============================================================================

/// Sort type for pivot table fields (ST_SortType, §18.18.72).
///
/// Specifies the sort order for items in a pivot table field. This is distinct
/// from the tables `SortBy` type.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PivotSortType {
    /// No sorting (default).
    #[default]
    #[xml("none")]
    None,
    /// Ascending sort.
    #[xml("ascending")]
    Ascending,
    /// Descending sort.
    #[xml("descending")]
    Descending,
    /// Ascending alphabetical sort.
    #[xml("ascendingAlpha")]
    AscendingAlpha,
    /// Descending alphabetical sort.
    #[xml("descendingAlpha")]
    DescendingAlpha,
    /// Ascending natural sort.
    #[xml("ascendingNatural")]
    AscendingNatural,
    /// Descending natural sort.
    #[xml("descendingNatural")]
    DescendingNatural,
}

// ============================================================================
// PivotAxisType — ST_Axis
// ============================================================================

/// Pivot axis type (ST_Axis, §18.18.78).
///
/// Specifies which axis a pivot field is placed on.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PivotAxisType {
    /// No axis (default).
    #[default]
    #[xml("none", alias = "")]
    None,
    /// All axes (used in area references).
    #[xml("all")]
    All,
    /// Row axis.
    #[xml("axisRow", alias = "row")]
    Row,
    /// Column axis.
    #[xml("axisCol", alias = "column")]
    Column,
}

// ============================================================================
// PivotArea — CT_PivotArea (referenced by many pivot types)
// ============================================================================

/// Pivot area selection rule (CT_PivotArea).
///
/// Defines a region within a pivot table for formatting, conditional formatting,
/// or other operations. Used as a child of CT_Format, CT_ConditionalFormat,
/// CT_CalculatedItem, CT_AutoSortScope, and CT_ChartFormat.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotArea {
    /// Index of the field this area applies to.
    pub field: Option<i32>,
    /// Type of selection (e.g. "normal", "data", "all", "origin", "button", "topEnd").
    pub r#type: Option<String>,
    /// Whether data values only are selected. Default: `true`.
    pub data_only: bool,
    /// Whether label cells only are selected. Default: `false`.
    pub label_only: bool,
    /// Whether to include the grand row. Default: `false`.
    pub grand_row: bool,
    /// Whether to include the grand column. Default: `false`.
    pub grand_col: bool,
    /// Whether cache-based indices. Default: `false`.
    pub cache_index: bool,
    /// Whether to outline the selection. Default: `true`.
    pub outline: bool,
    /// Cell reference offset.
    pub offset: Option<String>,
    /// Whether to collapse subtotals. Default: `false`.
    pub collection_index: bool,
    /// Axis for the field (e.g. "axisRow", "axisCol", "axisPage", "axisValues").
    pub axis: Option<String>,
    /// Field position within the axis.
    pub field_position: Option<u32>,
    /// Pivot area references.
    pub references: Vec<PivotAreaReference>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotArea {
    fn default() -> Self {
        Self {
            field: None,
            r#type: None,
            data_only: true,
            label_only: false,
            grand_row: false,
            grand_col: false,
            cache_index: false,
            outline: true,
            offset: None,
            collection_index: false,
            axis: None,
            field_position: None,
            references: Vec::new(),
            ext_lst: None,
        }
    }
}

/// Pivot area reference (CT_PivotAreaReference).
///
/// A single field reference within a pivot area, identifying specific items.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotAreaReference {
    /// Field index.
    pub field: Option<u32>,
    /// Number of item selections.
    pub count: Option<u32>,
    /// Whether selected items are included. Default: `true`.
    pub selected: bool,
    /// Whether items from the position axis. Default: `false`.
    pub by_position: bool,
    /// Whether relative reference. Default: `false`.
    pub relative: bool,
    /// Whether default subtotal. Default: `false`.
    pub default_subtotal: bool,
    /// Whether to include sum subtotal. Default: `false`.
    pub sum_subtotal: bool,
    /// Whether to include count-all subtotal. Default: `false`.
    pub count_a_subtotal: bool,
    /// Whether to include average subtotal. Default: `false`.
    pub avg_subtotal: bool,
    /// Whether to include max subtotal. Default: `false`.
    pub max_subtotal: bool,
    /// Whether to include min subtotal. Default: `false`.
    pub min_subtotal: bool,
    /// Whether to include product subtotal. Default: `false`.
    pub product_subtotal: bool,
    /// Whether to include count subtotal. Default: `false`.
    pub count_subtotal: bool,
    /// Whether to include stdDev subtotal. Default: `false`.
    pub std_dev_subtotal: bool,
    /// Whether to include stdDevP subtotal. Default: `false`.
    pub std_dev_p_subtotal: bool,
    /// Whether to include var subtotal. Default: `false`.
    pub var_subtotal: bool,
    /// Whether to include varP subtotal. Default: `false`.
    pub var_p_subtotal: bool,
    /// Item index values (x elements).
    pub items: Vec<u32>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotAreaReference {
    fn default() -> Self {
        Self {
            field: None,
            count: None,
            selected: true,
            by_position: false,
            relative: false,
            default_subtotal: false,
            sum_subtotal: false,
            count_a_subtotal: false,
            avg_subtotal: false,
            max_subtotal: false,
            min_subtotal: false,
            product_subtotal: false,
            count_subtotal: false,
            std_dev_subtotal: false,
            std_dev_p_subtotal: false,
            var_subtotal: false,
            var_p_subtotal: false,
            items: Vec::new(),
            ext_lst: None,
        }
    }
}

// ============================================================================
// PivotFormat — CT_Format
// ============================================================================

/// Pivot table format definition (CT_Format).
///
/// Associates a formatting action and differential format with a pivot area.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotFormat {
    /// Type of formatting action. Default: `Formatting`.
    pub action: PivotFormatAction,
    /// Differential format ID (index into the stylesheet dxfs).
    pub dxf_id: Option<u32>,
    /// Pivot area this format applies to.
    pub pivot_area: PivotArea,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotFormat {
    fn default() -> Self {
        Self {
            action: PivotFormatAction::Formatting,
            dxf_id: None,
            pivot_area: PivotArea::default(),
            ext_lst: None,
        }
    }
}

// ============================================================================
// PivotFormats — CT_Formats
// ============================================================================

/// Collection of pivot table format definitions (CT_Formats).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotFormats {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The format definitions.
    pub items: Vec<PivotFormat>,
    /// Format elements (`<format>`). XSD: CT_Format, 1..unbounded. // XSD: required
    #[serde(rename = "format")]
    pub format: Vec<PivotFormat>,
}

// ============================================================================
// PivotCalculatedItem — CT_CalculatedItem
// ============================================================================

/// Calculated item definition (CT_CalculatedItem).
///
/// A formula-based item added to a pivot field.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotCalculatedItem {
    /// Field index this calculated item belongs to.
    pub field: Option<u32>,
    /// Formula for the calculated item.
    pub formula: Option<String>,
    /// Pivot area defining the scope.
    pub pivot_area: PivotArea,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// PivotCalculatedItems — CT_CalculatedItems
// ============================================================================

/// Collection of calculated item definitions (CT_CalculatedItems).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotCalculatedItems {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The calculated items.
    pub items: Vec<PivotCalculatedItem>,
    /// Calculated item elements (`<calculatedItem>`). XSD: CT_CalculatedItem, 1..unbounded. // XSD: required
    #[serde(rename = "calculatedItem")]
    pub calculated_item: Vec<PivotCalculatedItem>,
}

// ============================================================================
// PivotCalculatedMember — CT_CalculatedMember
// ============================================================================

/// Calculated member definition (CT_CalculatedMember).
///
/// An OLAP calculated member defined via MDX expression.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotCalculatedMember {
    /// Calculated member name.
    pub name: String,
    /// MDX expression.
    pub mdx: String,
    /// Member name reference.
    pub member_name: Option<String>,
    /// Hierarchy this member belongs to.
    pub hierarchy: Option<String>,
    /// Parent member reference.
    pub parent: Option<String>,
    /// Solve order. Default: `0`.
    pub solve_order: i32,
    /// Whether this is a named set. Default: `false`.
    pub set: bool,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// PivotCalculatedMembers — CT_CalculatedMembers
// ============================================================================

/// Collection of calculated member definitions (CT_CalculatedMembers).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotCalculatedMembers {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The calculated members.
    pub items: Vec<PivotCalculatedMember>,
    /// Calculated member elements (`<calculatedMember>`). XSD: CT_CalculatedMember, 1..unbounded. // XSD: required
    #[serde(rename = "calculatedMember")]
    pub calculated_member: Vec<PivotCalculatedMember>,
}

// ============================================================================
// PivotChartFormat — CT_ChartFormat
// ============================================================================

/// Chart format definition for a pivot chart (CT_ChartFormat).
///
/// Associates a chart element with a pivot area and series formatting.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotChartFormat {
    /// Chart index.
    pub chart: u32,
    /// Format index.
    pub format: u32,
    /// Whether this applies to a series. Default: `false`.
    pub series: bool,
    /// Pivot area this chart format applies to.
    pub pivot_area: PivotArea,
}

// ============================================================================
// PivotChartFormats — CT_ChartFormats
// ============================================================================

/// Collection of chart format definitions (CT_ChartFormats).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotChartFormats {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The chart format definitions.
    pub items: Vec<PivotChartFormat>,
    /// Chart format elements (`<chartFormat>`). XSD: CT_ChartFormat, 1..unbounded. // XSD: required
    #[serde(rename = "chartFormat")]
    pub chart_format: Vec<PivotChartFormat>,
}

// ============================================================================
// PivotConditionalFormat — CT_ConditionalFormat
// ============================================================================

/// Conditional format definition for a pivot table (CT_ConditionalFormat).
///
/// Links conditional formatting rules to pivot table areas.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotConditionalFormat {
    /// Scope of the conditional format (e.g. "selection", "data", "field").
    pub scope: Option<String>,
    /// Type of conditional format (e.g. "none", "all", "row", "column").
    pub r#type: Option<String>,
    /// Priority of the conditional format rule.
    pub priority: u32,
    /// Pivot areas this conditional format applies to.
    pub pivot_areas: Vec<PivotArea>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotConditionalFormat {
    fn default() -> Self {
        Self {
            scope: Some("selection".to_string()),
            r#type: None,
            priority: 0,
            pivot_areas: Vec::new(),
            ext_lst: None,
        }
    }
}

// ============================================================================
// PivotConditionalFormats — CT_ConditionalFormats
// ============================================================================

/// Collection of conditional format definitions (CT_ConditionalFormats).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotConditionalFormats {
    /// Number of items (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// The conditional format definitions.
    pub items: Vec<PivotConditionalFormat>,
    /// Conditional format elements (`<conditionalFormat>`). XSD: CT_ConditionalFormat, 1..unbounded. // XSD: required
    #[serde(rename = "conditionalFormat")]
    pub conditional_format: Vec<PivotConditionalFormat>,
}

// ============================================================================
// PivotFilter — CT_PivotFilter (placeholder)
// ============================================================================

/// A single pivot table filter (CT_PivotFilter, §18.10.1.66).
///
/// Placeholder — stored as raw string until fully typed.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotFilter {
    /// Field index this filter applies to. // XSD: required
    pub fld: Option<u32>,
    /// Filter type. // XSD: required
    pub r#type: Option<String>,
    /// Unique filter ID. // XSD: required
    pub id: Option<u32>,
    /// Auto-filter criteria. // XSD: required
    #[serde(rename = "autoFilter")]
    pub auto_filter: Option<crate::worksheet::AutoFilter>,
    /// Raw inner XML (placeholder for remaining elements).
    pub raw: String,
}

// ============================================================================
// PivotFilters — CT_PivotFilters
// ============================================================================

/// Collection of pivot table filters (CT_PivotFilters, §18.10.1.65).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotFilters {
    /// Number of items (informational).
    pub count: Option<u32>,
    /// The pivot filter definitions.
    pub items: Vec<PivotFilter>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_format_action_roundtrip() {
        let variants = [
            (PivotFormatAction::Blank, "blank"),
            (PivotFormatAction::Formatting, "formatting"),
            (PivotFormatAction::Drill, "drill"),
            (PivotFormatAction::Formula, "formula"),
        ];
        for (variant, s) in &variants {
            assert_eq!(
                PivotFormatAction::from_ooxml(s),
                *variant,
                "from_ooxml({s})"
            );
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotFormatAction::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(
            PivotFormatAction::from_ooxml("bogus"),
            PivotFormatAction::Formatting
        );
    }

    #[test]
    fn pivot_area_default() {
        let pa = PivotArea::default();
        assert!(pa.field.is_none());
        assert!(pa.r#type.is_none());
        assert!(pa.data_only);
        assert!(!pa.label_only);
        assert!(!pa.grand_row);
        assert!(!pa.grand_col);
        assert!(!pa.cache_index);
        assert!(pa.outline);
        assert!(pa.offset.is_none());
        assert!(!pa.collection_index);
        assert!(pa.axis.is_none());
        assert!(pa.field_position.is_none());
        assert!(pa.references.is_empty());
        assert!(pa.ext_lst.is_none());
    }

    #[test]
    fn pivot_format_default() {
        let f = PivotFormat::default();
        assert_eq!(f.action, PivotFormatAction::Formatting);
        assert!(f.dxf_id.is_none());
        assert!(f.ext_lst.is_none());
    }

    #[test]
    fn pivot_calculated_member_default() {
        let cm = PivotCalculatedMember::default();
        assert!(cm.name.is_empty());
        assert!(cm.mdx.is_empty());
        assert!(cm.member_name.is_none());
        assert!(cm.hierarchy.is_none());
        assert!(cm.parent.is_none());
        assert_eq!(cm.solve_order, 0);
        assert!(!cm.set);
        assert!(cm.ext_lst.is_none());
    }

    #[test]
    fn layout_wrapper_types_default() {
        let pf = PivotFormats::default();
        assert!(pf.count.is_none());
        assert!(pf.items.is_empty());
        assert!(pf.format.is_empty());

        let ci = PivotCalculatedItems::default();
        assert!(ci.count.is_none());
        assert!(ci.items.is_empty());

        let cm = PivotCalculatedMembers::default();
        assert!(cm.count.is_none());
        assert!(cm.items.is_empty());

        let ccf = PivotChartFormats::default();
        assert!(ccf.count.is_none());
        assert!(ccf.items.is_empty());
        assert!(ccf.chart_format.is_empty());

        let pcf = PivotConditionalFormats::default();
        assert!(pcf.count.is_none());
        assert!(pcf.items.is_empty());
        assert!(pcf.conditional_format.is_empty());
    }

    #[test]
    fn pivot_chart_format_default() {
        let cf = PivotChartFormat::default();
        assert_eq!(cf.chart, 0);
        assert_eq!(cf.format, 0);
        assert!(!cf.series);
    }

    #[test]
    fn pivot_conditional_format_default() {
        let cf = PivotConditionalFormat::default();
        assert_eq!(cf.scope, Some("selection".to_string()));
        assert!(cf.r#type.is_none());
        assert_eq!(cf.priority, 0);
        assert!(cf.pivot_areas.is_empty());
        assert!(cf.ext_lst.is_none());
    }

    #[test]
    fn pivot_area_type_roundtrip() {
        let variants = [
            (PivotAreaType::None, "none"),
            (PivotAreaType::Normal, "normal"),
            (PivotAreaType::Data, "data"),
            (PivotAreaType::All, "all"),
            (PivotAreaType::Origin, "origin"),
            (PivotAreaType::Button, "button"),
            (PivotAreaType::TopEnd, "topEnd"),
            (PivotAreaType::TopRight, "topRight"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotAreaType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotAreaType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(PivotAreaType::from_ooxml("bogus"), PivotAreaType::None);
        assert_eq!(PivotAreaType::default(), PivotAreaType::None);
    }

    #[test]
    fn pivot_filter_type_roundtrip() {
        let variants = [
            (PivotFilterType::Unknown, "unknown"),
            (PivotFilterType::Count, "count"),
            (PivotFilterType::Percent, "percent"),
            (PivotFilterType::Sum, "sum"),
            (PivotFilterType::CaptionEqual, "captionEqual"),
            (PivotFilterType::CaptionNotEqual, "captionNotEqual"),
            (PivotFilterType::CaptionBeginsWith, "captionBeginsWith"),
            (
                PivotFilterType::CaptionNotBeginsWith,
                "captionNotBeginsWith",
            ),
            (PivotFilterType::CaptionEndsWith, "captionEndsWith"),
            (PivotFilterType::CaptionNotEndsWith, "captionNotEndsWith"),
            (PivotFilterType::CaptionContains, "captionContains"),
            (PivotFilterType::CaptionNotContains, "captionNotContains"),
            (PivotFilterType::CaptionGreaterThan, "captionGreaterThan"),
            (
                PivotFilterType::CaptionGreaterThanOrEqual,
                "captionGreaterThanOrEqual",
            ),
            (PivotFilterType::CaptionLessThan, "captionLessThan"),
            (
                PivotFilterType::CaptionLessThanOrEqual,
                "captionLessThanOrEqual",
            ),
            (PivotFilterType::CaptionBetween, "captionBetween"),
            (PivotFilterType::CaptionNotBetween, "captionNotBetween"),
            (PivotFilterType::ValueEqual, "valueEqual"),
            (PivotFilterType::ValueNotEqual, "valueNotEqual"),
            (PivotFilterType::ValueGreaterThan, "valueGreaterThan"),
            (
                PivotFilterType::ValueGreaterThanOrEqual,
                "valueGreaterThanOrEqual",
            ),
            (PivotFilterType::ValueLessThan, "valueLessThan"),
            (
                PivotFilterType::ValueLessThanOrEqual,
                "valueLessThanOrEqual",
            ),
            (PivotFilterType::ValueBetween, "valueBetween"),
            (PivotFilterType::ValueNotBetween, "valueNotBetween"),
            (PivotFilterType::DateEqual, "dateEqual"),
            (PivotFilterType::DateNotEqual, "dateNotEqual"),
            (PivotFilterType::DateOlderThan, "dateOlderThan"),
            (
                PivotFilterType::DateOlderThanOrEqual,
                "dateOlderThanOrEqual",
            ),
            (PivotFilterType::DateNewerThan, "dateNewerThan"),
            (
                PivotFilterType::DateNewerThanOrEqual,
                "dateNewerThanOrEqual",
            ),
            (PivotFilterType::DateBetween, "dateBetween"),
            (PivotFilterType::DateNotBetween, "dateNotBetween"),
            (PivotFilterType::Tomorrow, "tomorrow"),
            (PivotFilterType::Today, "today"),
            (PivotFilterType::Yesterday, "yesterday"),
            (PivotFilterType::ThisWeek, "thisWeek"),
            (PivotFilterType::LastWeek, "lastWeek"),
            (PivotFilterType::NextWeek, "nextWeek"),
            (PivotFilterType::ThisMonth, "thisMonth"),
            (PivotFilterType::LastMonth, "lastMonth"),
            (PivotFilterType::NextMonth, "nextMonth"),
            (PivotFilterType::ThisQuarter, "thisQuarter"),
            (PivotFilterType::LastQuarter, "lastQuarter"),
            (PivotFilterType::NextQuarter, "nextQuarter"),
            (PivotFilterType::ThisYear, "thisYear"),
            (PivotFilterType::LastYear, "lastYear"),
            (PivotFilterType::NextYear, "nextYear"),
            (PivotFilterType::YearToDate, "yearToDate"),
            (PivotFilterType::Q1, "Q1"),
            (PivotFilterType::Q2, "Q2"),
            (PivotFilterType::Q3, "Q3"),
            (PivotFilterType::Q4, "Q4"),
            (PivotFilterType::M1, "M1"),
            (PivotFilterType::M2, "M2"),
            (PivotFilterType::M3, "M3"),
            (PivotFilterType::M4, "M4"),
            (PivotFilterType::M5, "M5"),
            (PivotFilterType::M6, "M6"),
            (PivotFilterType::M7, "M7"),
            (PivotFilterType::M8, "M8"),
            (PivotFilterType::M9, "M9"),
            (PivotFilterType::M10, "M10"),
            (PivotFilterType::M11, "M11"),
            (PivotFilterType::M12, "M12"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotFilterType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotFilterType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(
            PivotFilterType::from_ooxml("bogus"),
            PivotFilterType::Unknown
        );
        assert_eq!(PivotFilterType::default(), PivotFilterType::Unknown);
    }

    #[test]
    fn pivot_scope_roundtrip() {
        let variants = [
            (PivotScope::Selection, "selection"),
            (PivotScope::Data, "data"),
            (PivotScope::Field, "field"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotScope::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotScope::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(PivotScope::from_ooxml("bogus"), PivotScope::Selection);
        assert_eq!(PivotScope::default(), PivotScope::Selection);
    }

    #[test]
    fn pivot_sort_type_roundtrip() {
        let variants = [
            (PivotSortType::None, "none"),
            (PivotSortType::Ascending, "ascending"),
            (PivotSortType::Descending, "descending"),
            (PivotSortType::AscendingAlpha, "ascendingAlpha"),
            (PivotSortType::DescendingAlpha, "descendingAlpha"),
            (PivotSortType::AscendingNatural, "ascendingNatural"),
            (PivotSortType::DescendingNatural, "descendingNatural"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotSortType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotSortType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(PivotSortType::from_ooxml("bogus"), PivotSortType::None);
        assert_eq!(PivotSortType::default(), PivotSortType::None);
    }

    #[test]
    fn pivot_axis_type_roundtrip() {
        let variants = [
            (PivotAxisType::None, "none"),
            (PivotAxisType::All, "all"),
            (PivotAxisType::Row, "axisRow"),
            (PivotAxisType::Column, "axisCol"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotAxisType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotAxisType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(PivotAxisType::from_ooxml(""), PivotAxisType::None);
        assert_eq!(PivotAxisType::from_ooxml("row"), PivotAxisType::Row);
        assert_eq!(PivotAxisType::from_ooxml("column"), PivotAxisType::Column);
        assert_eq!(PivotAxisType::from_bytes(b"row"), PivotAxisType::Row);
        assert_eq!(PivotAxisType::from_bytes(b"column"), PivotAxisType::Column);
        assert_eq!(PivotAxisType::from_ooxml("bogus"), PivotAxisType::None);
        assert_eq!(PivotAxisType::default(), PivotAxisType::None);
    }
}
