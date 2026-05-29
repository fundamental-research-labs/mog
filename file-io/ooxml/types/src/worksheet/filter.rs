//! Auto filter, sort state, and related types (CT_AutoFilter, CT_SortState).

use crate::cond_format::IconSetType;
use crate::tables::{DynamicFilterType, FilterOperator, SortBy};

// ============================================================================
// DateTimeGrouping -- ST_DateTimeGrouping (§18.18.15)
// ============================================================================

/// Date/time grouping granularity (ST_DateTimeGrouping).
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
pub enum DateTimeGrouping {
    /// Group by year (default)
    #[default]
    #[xml("year")]
    Year,
    /// Group by month
    #[xml("month")]
    Month,
    /// Group by day
    #[xml("day")]
    Day,
    /// Group by hour
    #[xml("hour")]
    Hour,
    /// Group by minute
    #[xml("minute")]
    Minute,
    /// Group by second
    #[xml("second")]
    Second,
}

// ============================================================================
// CalendarType -- ST_CalendarType (§18.18.3)
// ============================================================================

/// Calendar type (ST_CalendarType).
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
pub enum CalendarType {
    /// No calendar type (default)
    #[default]
    #[xml("none")]
    None,
    /// Gregorian calendar
    #[xml("gregorian")]
    Gregorian,
    /// Gregorian US calendar
    #[xml("gregorianUs")]
    GregorianUs,
    /// Japanese Emperor Era calendar
    #[xml("japan")]
    Japan,
    /// Taiwan calendar
    #[xml("taiwan")]
    Taiwan,
    /// Korean Tangun Era calendar
    #[xml("korea")]
    Korea,
    /// Hijri (Arabic Lunar) calendar
    #[xml("hijri")]
    Hijri,
    /// Thai calendar
    #[xml("thai")]
    Thai,
    /// Hebrew (Lunar) calendar
    #[xml("hebrew")]
    Hebrew,
    /// Saka Era calendar
    #[xml("saka")]
    Saka,
    /// Gregorian Middle East French calendar
    #[xml("gregorianMeFrench")]
    GregorianMeFrench,
    /// Gregorian Arabic calendar
    #[xml("gregorianArabic")]
    GregorianArabic,
    /// Gregorian transliterated English calendar
    #[xml("gregorianXlitEnglish")]
    GregorianXlitEnglish,
    /// Gregorian transliterated French calendar
    #[xml("gregorianXlitFrench")]
    GregorianXlitFrench,
}

// ============================================================================
// SortMethod -- ST_SortMethod (§18.18.72)
// ============================================================================

/// Sort method (ST_SortMethod).
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
pub enum SortMethod {
    /// Sort by stroke count
    #[xml("stroke")]
    Stroke,
    /// Sort by PinYin
    #[xml("pinYin")]
    PinYin,
    /// No specific sort method (default)
    #[default]
    #[xml("none")]
    None,
}

// ============================================================================
// AutoFilter -- CT_AutoFilter (§18.3.1.2)
// ============================================================================

/// Auto filter definition (CT_AutoFilter, §18.3.1.2).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct AutoFilter {
    /// Reference range for the auto filter (e.g., "A1:D10").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_range: Option<String>,
    /// Filter columns within this auto filter.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_column: Vec<FilterColumn>,
    /// Sort state applied within the auto filter.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<SortState>,
    /// Extension list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// FilterColumn -- CT_FilterColumn (§18.3.2.7)
// ============================================================================

/// A single filter column within an auto filter (CT_FilterColumn, §18.3.2.7).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FilterColumn {
    /// Zero-based column index within the auto filter range.
    pub col_id: u32,
    /// Whether the filter button is hidden.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub hidden_button: bool,
    /// Whether the filter button is shown (default: true per spec).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_button: bool,
    /// The type of filter applied to this column.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_type: Option<FilterColumnType>,
    /// Extension list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for FilterColumn {
    fn default() -> Self {
        Self {
            col_id: 0,
            hidden_button: false,
            show_button: true,
            filter_type: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// FilterColumnType -- choice group
// ============================================================================

/// Filter column type (choice group within CT_FilterColumn).
///
/// Each filter column may contain exactly one of these filter types.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum FilterColumnType {
    /// Value-based filters (CT_Filters).
    Filters(Filters),
    /// Custom filters with operators (CT_CustomFilters).
    CustomFilters(CustomFilters),
    /// Top N / Bottom N filter (CT_Top10).
    Top10(Top10),
    /// Dynamic filter (CT_DynamicFilter).
    DynamicFilter(DynamicFilter),
    /// Color-based filter (CT_ColorFilter).
    ColorFilter(ColorFilter),
    /// Icon-based filter (CT_IconFilter).
    IconFilter(IconFilter),
}

// ============================================================================
// Filters -- CT_Filters (§18.3.2.8)
// ============================================================================

/// Value-based filters (CT_Filters, §18.3.2.8).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Filters {
    /// Whether to include blank cells.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub blank: bool,
    /// Calendar type for date grouping.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calendar_type: Option<CalendarType>,
    /// Individual filter values.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter: Vec<String>,
    /// Date group items.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub date_group_item: Vec<DateGroupItem>,
}

// ============================================================================
// DateGroupItem -- CT_DateGroupItem (§18.3.2.4)
// ============================================================================

/// Date group item for date-based filtering (CT_DateGroupItem, §18.3.2.4).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DateGroupItem {
    /// Year component (required).
    pub year: u16,
    /// Month component (1-12).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub month: Option<u16>,
    /// Day component (1-31).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day: Option<u16>,
    /// Hour component (0-23).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hour: Option<u16>,
    /// Minute component (0-59).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minute: Option<u16>,
    /// Second component (0-59).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub second: Option<u16>,
    /// Grouping granularity.
    pub date_time_grouping: DateTimeGrouping,
}

// ============================================================================
// CustomFilters -- CT_CustomFilters (§18.3.2.2)
// ============================================================================

/// Custom filters with operators (CT_CustomFilters, §18.3.2.2).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CustomFilters {
    /// Whether to AND the filters (default: false = OR).
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub and: bool,
    /// Individual custom filter criteria.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_filter: Vec<CustomFilter>,
}

// ============================================================================
// CustomFilter -- CT_CustomFilter (§18.3.2.3)
// ============================================================================

/// A single custom filter criterion (CT_CustomFilter, §18.3.2.3).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomFilter {
    /// The comparison operator (reused from tables).
    pub operator: FilterOperator,
    /// The value to compare against.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub val: Option<String>,
}

impl Default for CustomFilter {
    fn default() -> Self {
        Self {
            operator: FilterOperator::Equal,
            val: None,
        }
    }
}

// ============================================================================
// Top10 -- CT_Top10 (§18.3.2.10)
// ============================================================================

/// Top N / Bottom N filter (CT_Top10, §18.3.2.10).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Top10 {
    /// Whether to filter from the top (default: true per spec).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub top: bool,
    /// Whether val is a percentage.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub percent: bool,
    /// The number of items (or percentage) to filter.
    pub val: f64,
    /// The actual filter value computed by the application.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_val: Option<f64>,
}

impl Default for Top10 {
    fn default() -> Self {
        Self {
            top: true,
            percent: false,
            val: 0.0,
            filter_val: None,
        }
    }
}

// ============================================================================
// DynamicFilter -- CT_DynamicFilter (§18.3.2.5)
// ============================================================================

/// Dynamic filter (CT_DynamicFilter, §18.3.2.5).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DynamicFilter {
    /// The dynamic filter type (reused from tables).
    pub r#type: DynamicFilterType,
    /// Computed value for the filter.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub val: Option<f64>,
    /// Maximum value for range-based dynamic filters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_val: Option<f64>,
    /// ISO datetime value for date-based dynamic filters (valIso attribute).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub val_iso: Option<String>,
    /// Maximum ISO datetime value for range-based dynamic filters (maxValIso attribute).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_val_iso: Option<String>,
}

impl Default for DynamicFilter {
    fn default() -> Self {
        Self {
            r#type: DynamicFilterType::Null,
            val: None,
            max_val: None,
            val_iso: None,
            max_val_iso: None,
        }
    }
}

// ============================================================================
// ColorFilter -- CT_ColorFilter (§18.3.2.1)
// ============================================================================

/// Color-based filter (CT_ColorFilter, §18.3.2.1).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorFilter {
    /// Differential formatting record ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
    /// Whether to filter by cell color (true) or font color (false).
    /// Default: true per spec.
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub cell_color: bool,
}

impl Default for ColorFilter {
    fn default() -> Self {
        Self {
            dxf_id: None,
            cell_color: true,
        }
    }
}

// ============================================================================
// IconFilter -- CT_IconFilter (§18.3.2.9)
// ============================================================================

/// Icon-based filter (CT_IconFilter, §18.3.2.9).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct IconFilter {
    /// Icon set name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<String>,
    /// Zero-based icon index within the icon set.
    pub icon_id: u32,
}

// ============================================================================
// SortState -- CT_SortState (§18.3.1.92)
// ============================================================================

/// Sort state (CT_SortState, §18.3.1.92).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SortState {
    /// Whether sorting by columns (true) or rows (false).
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub column_sort: bool,
    /// Whether the sort is case-sensitive.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub case_sensitive: bool,
    /// Sort method for CJK languages.
    #[serde(default)]
    pub sort_method: SortMethod,
    /// Reference range for the sort (e.g., "A1:D10").
    pub ref_range: String,
    /// Individual sort conditions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sort_condition: Vec<SortCondition>,
    /// Extension list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for SortState {
    fn default() -> Self {
        Self {
            column_sort: false,
            case_sensitive: false,
            sort_method: SortMethod::None,
            ref_range: String::new(),
            sort_condition: Vec::new(),
            ext_lst: None,
        }
    }
}

// ============================================================================
// SortCondition -- CT_SortCondition (§18.3.1.91)
// ============================================================================

/// A single sort condition (CT_SortCondition, §18.3.1.91).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SortCondition {
    /// Whether to sort in descending order.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub descending: bool,
    /// What to sort by (reused from tables).
    #[serde(default)]
    pub sort_by: SortBy,
    /// Reference range for this condition.
    pub ref_range: String,
    /// Custom sort list name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_list: Option<String>,
    /// Differential formatting record ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
    /// Icon set type for icon sorts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<IconSetType>,
    /// Icon index within the icon set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<u32>,
}

impl Default for SortCondition {
    fn default() -> Self {
        Self {
            descending: false,
            sort_by: SortBy::Value,
            ref_range: String::new(),
            custom_list: None,
            dxf_id: None,
            icon_set: None,
            icon_id: None,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- DateTimeGrouping ---

    #[test]
    fn date_time_grouping_roundtrip() {
        let variants = [
            DateTimeGrouping::Year,
            DateTimeGrouping::Month,
            DateTimeGrouping::Day,
            DateTimeGrouping::Hour,
            DateTimeGrouping::Minute,
            DateTimeGrouping::Second,
        ];
        for v in &variants {
            assert_eq!(DateTimeGrouping::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    #[test]
    fn date_time_grouping_from_bytes() {
        let variants = [
            DateTimeGrouping::Year,
            DateTimeGrouping::Month,
            DateTimeGrouping::Day,
            DateTimeGrouping::Hour,
            DateTimeGrouping::Minute,
            DateTimeGrouping::Second,
        ];
        for v in &variants {
            assert_eq!(DateTimeGrouping::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
        assert_eq!(
            DateTimeGrouping::from_bytes(b"bogus"),
            DateTimeGrouping::Year
        );
    }

    // --- CalendarType ---

    #[test]
    fn calendar_type_roundtrip() {
        let variants = [
            CalendarType::None,
            CalendarType::Gregorian,
            CalendarType::GregorianUs,
            CalendarType::Japan,
            CalendarType::Taiwan,
            CalendarType::Korea,
            CalendarType::Hijri,
            CalendarType::Thai,
            CalendarType::Hebrew,
            CalendarType::GregorianMeFrench,
            CalendarType::GregorianArabic,
            CalendarType::GregorianXlitEnglish,
            CalendarType::GregorianXlitFrench,
        ];
        for v in &variants {
            assert_eq!(CalendarType::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    #[test]
    fn calendar_type_from_bytes() {
        let variants = [
            CalendarType::None,
            CalendarType::Gregorian,
            CalendarType::GregorianUs,
            CalendarType::Japan,
            CalendarType::Taiwan,
            CalendarType::Korea,
            CalendarType::Hijri,
            CalendarType::Thai,
            CalendarType::Hebrew,
            CalendarType::GregorianMeFrench,
            CalendarType::GregorianArabic,
            CalendarType::GregorianXlitEnglish,
            CalendarType::GregorianXlitFrench,
        ];
        for v in &variants {
            assert_eq!(CalendarType::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
        assert_eq!(CalendarType::from_bytes(b"bogus"), CalendarType::None);
    }

    // --- SortMethod ---

    #[test]
    fn sort_method_roundtrip() {
        let variants = [SortMethod::Stroke, SortMethod::PinYin, SortMethod::None];
        for v in &variants {
            assert_eq!(SortMethod::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(v.as_str(), v.to_ooxml());
        }
    }

    #[test]
    fn sort_method_from_bytes() {
        let variants = [SortMethod::Stroke, SortMethod::PinYin, SortMethod::None];
        for v in &variants {
            assert_eq!(SortMethod::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
        assert_eq!(SortMethod::from_bytes(b"bogus"), SortMethod::None);
    }

    // --- AutoFilter ---

    #[test]
    fn auto_filter_defaults() {
        let af = AutoFilter::default();
        assert!(af.ref_range.is_none());
        assert!(af.filter_column.is_empty());
        assert!(af.sort_state.is_none());
    }

    // --- FilterColumn ---

    #[test]
    fn filter_column_default_show_button_true() {
        let fc = FilterColumn::default();
        assert!(fc.show_button);
        assert!(!fc.hidden_button);
        assert_eq!(fc.col_id, 0);
        assert!(fc.filter_type.is_none());
    }

    // --- Top10 ---

    #[test]
    fn top10_default_top_true() {
        let t = Top10::default();
        assert!(t.top);
        assert!(!t.percent);
        assert_eq!(t.val, 0.0);
        assert!(t.filter_val.is_none());
    }

    // --- ColorFilter ---

    #[test]
    fn color_filter_default_cell_color_true() {
        let cf = ColorFilter::default();
        assert!(cf.cell_color);
        assert!(cf.dxf_id.is_none());
    }

    // --- CustomFilters ---

    #[test]
    fn custom_filters_default_is_or() {
        let cf = CustomFilters::default();
        assert!(!cf.and);
        assert!(cf.custom_filter.is_empty());
    }

    // --- FilterColumnType ---

    #[test]
    fn filter_column_type_variants() {
        let variants: Vec<FilterColumnType> = vec![
            FilterColumnType::Filters(Filters::default()),
            FilterColumnType::CustomFilters(CustomFilters::default()),
            FilterColumnType::Top10(Top10::default()),
            FilterColumnType::DynamicFilter(DynamicFilter::default()),
            FilterColumnType::ColorFilter(ColorFilter::default()),
            FilterColumnType::IconFilter(IconFilter::default()),
        ];
        for v in &variants {
            match v {
                FilterColumnType::Filters(_) => {}
                FilterColumnType::CustomFilters(_) => {}
                FilterColumnType::Top10(_) => {}
                FilterColumnType::DynamicFilter(_) => {}
                FilterColumnType::ColorFilter(_) => {}
                FilterColumnType::IconFilter(_) => {}
            }
        }
        assert_eq!(variants.len(), 6);
    }

    // --- SortState ---

    #[test]
    fn sort_state_defaults() {
        let ss = SortState::default();
        assert!(ss.ref_range.is_empty());
        assert!(ss.sort_condition.is_empty());
        assert!(!ss.column_sort);
        assert!(!ss.case_sensitive);
        assert_eq!(ss.sort_method, SortMethod::None);
    }

    // --- SortCondition ---

    #[test]
    fn sort_condition_descending() {
        let sc = SortCondition {
            descending: true,
            sort_by: SortBy::CellColor,
            ref_range: "B1:B10".to_string(),
            custom_list: None,
            dxf_id: Some(3),
            icon_set: None,
            icon_id: None,
        };
        assert!(sc.descending);
        assert_eq!(sc.sort_by, SortBy::CellColor);
        assert_eq!(sc.ref_range, "B1:B10");
        assert_eq!(sc.dxf_id, Some(3));
    }

    // --- Serde roundtrip ---

    #[test]
    fn sort_state_serde_roundtrip() {
        let ss = SortState {
            column_sort: true,
            case_sensitive: true,
            sort_method: SortMethod::PinYin,
            ref_range: "A1:D20".to_string(),
            sort_condition: vec![
                SortCondition {
                    descending: true,
                    sort_by: SortBy::Value,
                    ref_range: "A1:A20".to_string(),
                    custom_list: Some("custom1".to_string()),
                    dxf_id: None,
                    icon_set: Some(IconSetType::ThreeArrows),
                    icon_id: Some(1),
                },
                SortCondition {
                    descending: false,
                    sort_by: SortBy::CellColor,
                    ref_range: "B1:B20".to_string(),
                    custom_list: None,
                    dxf_id: Some(5),
                    icon_set: None,
                    icon_id: None,
                },
            ],
            ext_lst: None,
        };
        let json = serde_json::to_string(&ss).expect("serialize");
        let deserialized: SortState = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(ss, deserialized);
    }
}
