// ============================================================================
// FilterOperator -- ST_FilterOperator
// ============================================================================

use crate::cond_format::IconSetType;
use crate::worksheet::CalendarType;

use super::{DateTimeGrouping, DynamicFilterType, SortState};

/// Filter operator type for custom filters (ST_FilterOperator).
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
pub enum FilterOperator {
    /// Equal to
    #[default]
    #[xml("equal")]
    Equal,
    /// Less than
    #[xml("lessThan")]
    LessThan,
    /// Less than or equal
    #[xml("lessThanOrEqual")]
    LessThanOrEqual,
    /// Not equal
    #[xml("notEqual")]
    NotEqual,
    /// Greater than or equal
    #[xml("greaterThanOrEqual")]
    GreaterThanOrEqual,
    /// Greater than
    #[xml("greaterThan")]
    GreaterThan,
}
// --- Filter-related composite types ---

/// Discrete value filter (CT_Filters).
///
/// Contains a list of discrete values and/or date group items to filter by.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Filters {
    /// Whether to include blank cells
    pub blank: bool,
    /// Calendar type for date group items (calendarType attribute, default "none").
    pub calendar_type: Option<CalendarType>,
    /// Discrete string values to match
    pub filter: Vec<String>,
    /// Date group items for date-based filtering
    pub date_group_item: Vec<DateGroupItem>,
}

/// Date group item for date-based discrete filtering (CT_DateGroupItem).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DateGroupItem {
    /// Year (required)
    pub year: u16,
    /// Month (1-12)
    pub month: Option<u16>,
    /// Day (1-31)
    pub day: Option<u16>,
    /// Hour (0-23)
    pub hour: Option<u16>,
    /// Minute (0-59)
    pub minute: Option<u16>,
    /// Second (0-59)
    pub second: Option<u16>,
    /// Grouping granularity
    pub date_time_grouping: DateTimeGrouping,
}

impl Default for DateGroupItem {
    fn default() -> Self {
        Self {
            year: 0,
            month: None,
            day: None,
            hour: None,
            minute: None,
            second: None,
            date_time_grouping: DateTimeGrouping::Year,
        }
    }
}

/// Top 10 filter (CT_Top10).
///
/// Filters by top or bottom N values or percentages.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Top10Filter {
    /// If true, filter top values; if false, filter bottom values
    pub top: bool,
    /// If true, val is a percentage; if false, val is an item count
    pub percent: bool,
    /// The threshold value (count or percentage)
    pub val: f64,
    /// The actual filter value computed from the data
    pub filter_val: Option<f64>,
}

impl Default for Top10Filter {
    fn default() -> Self {
        Self {
            top: true,
            percent: false,
            val: 0.0,
            filter_val: None,
        }
    }
}

/// Custom filters container (CT_CustomFilters).
///
/// Contains one or two custom filter criteria combined with AND or OR logic.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CustomFilters {
    /// If true, criteria are combined with AND; if false, with OR
    pub and: bool,
    /// Custom filter criteria (1 or 2)
    pub custom_filter: Vec<CustomFilter>,
}

/// A single custom filter criterion (CT_CustomFilter).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomFilter {
    /// Comparison operator
    pub operator: FilterOperator,
    /// Value to compare against
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

/// Dynamic filter (CT_DynamicFilter).
///
/// Filters data dynamically based on a date or value criterion.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DynamicFilter {
    /// Dynamic filter type (required)
    pub r#type: DynamicFilterType,
    /// Computed filter value
    pub val: Option<f64>,
    /// Maximum value for range-based filters
    pub max_val: Option<f64>,
    /// ISO datetime value for date-based dynamic filters (valIso attribute).
    pub val_iso: Option<String>,
    /// Maximum ISO datetime value for range-based dynamic filters (maxValIso attribute).
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

/// Color filter (CT_ColorFilter).
///
/// Filters by cell or font color.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorFilter {
    /// DXF (differential formatting) record ID
    pub dxf_id: Option<u32>,
    /// If true, filter by cell color; if false, by font color
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

/// Icon filter (CT_IconFilter).
///
/// Filters by conditional formatting icon.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct IconFilter {
    /// Icon set name (required)
    pub icon_set: IconSetType,
    /// Icon index within the set
    pub icon_id: Option<u32>,
}

/// Filter type discriminator for filter columns.
///
/// A filter column can have at most one of these filter types applied.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum FilterType {
    /// Discrete value filter
    Filters(Filters),
    /// Top/bottom N filter
    Top10(Top10Filter),
    /// Custom operator-based filter
    Custom(CustomFilters),
    /// Dynamic date/value filter
    Dynamic(DynamicFilter),
    /// Color-based filter
    ColorFilter(ColorFilter),
    /// Icon-based filter
    IconFilter(IconFilter),
}

/// A single filter column within an auto-filter (CT_FilterColumn).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FilterColumn {
    /// Zero-based column index within the table
    pub col_id: u32,
    /// Whether the dropdown button is hidden
    pub hidden_button: bool,
    /// Whether the dropdown button is shown
    pub show_button: bool,
    /// The filter applied to this column
    pub filter: Option<FilterType>,
}

impl Default for FilterColumn {
    fn default() -> Self {
        Self {
            col_id: 0,
            hidden_button: false,
            show_button: true,
            filter: None,
        }
    }
}

// --- AutoFilter ---

/// Auto-filter definition (CT_AutoFilter).
///
/// Defines filtering and optional sorting for a range of cells.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct AutoFilter {
    /// Range reference for the auto-filter area
    pub r#ref: Option<String>,
    /// Per-column filter definitions
    pub filter_columns: Vec<FilterColumn>,
    /// Sort state applied within the auto-filter
    pub sort_state: Option<SortState>,
}
