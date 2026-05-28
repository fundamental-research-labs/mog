//! Filter domain types.
//!
//! This module contains TWO sets of filter types:
//!
//! 1. **OOXML types** (`AutoFilter`, `FilterColumn`, `OoxmlFilterType`, etc.) — faithfully
//!    represent the ECMA-376 `<autoFilter>` XML element. Used by the XLSX parser for
//!    input/output. NOT stored in Yrs.
//!
//! 2. **Runtime types** (`FilterState`, `ColumnFilter`, `FilterKind`, etc.) — the canonical
//!    representation stored in Yrs and used by the compute engine. XLSX import transforms
//!    OOXML types into these; XLSX export reverses the transform.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use ooxml_types::cond_format::IconSetType;

/// Monotonic counter for generating unique filter IDs.
/// Replaces `SystemTime::now()` which panics on `wasm32-unknown-unknown`.
static NEXT_FILTER_ID: AtomicU64 = AtomicU64::new(0);
use serde::{Deserialize, Serialize};
use value_types::CellValue;

// ══════════════════════════════════════════════════════════════════════
// OOXML Types (XLSX parser I/O — not stored in Yrs)
// ══════════════════════════════════════════════════════════════════════

/// OOXML `<autoFilter>` element (CT_AutoFilter, §18.3.1.2).
///
/// Typed OOXML preservation extended this to be lossless over
/// CT_AutoFilter so that raw XML sidecars
/// raw-XML sidecar that the writer used to fall back to — could be deleted.
/// All sub-structures below expose the closed-XSD attributes explicitly;
/// remaining per-element `extLst` tails are carried in a typed
/// `extensions` field so vendor extensions survive round-trip even when
/// they're not semantically owned by the domain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct AutoFilter {
    pub range_ref: String,
    pub columns: Vec<FilterColumn>,
    pub sort: Option<SortState>,
    /// Excel revision UID (`xr:uid` attribute, xr namespace). Purely a
    /// round-trip passthrough — Excel writes a brace-wrapped GUID here for
    /// collaborative-edit tracking; runtime-created filters leave this `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
}

/// OOXML `<filterColumn>` element (CT_FilterColumn, §18.3.2.7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterColumn {
    pub col_index: u32,
    /// The CT_FilterColumn choice child. `None` preserves a childless
    /// `<filterColumn .../>`; `Some(Values { .. })` means an explicit
    /// `<filters>` child exists, even when it is empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_type: Option<OoxmlFilterType>,
    /// `hiddenButton` attribute — hide the filter dropdown in the UI.
    /// Defaults to false.
    #[serde(default)]
    pub hidden_button: bool,
    /// `showButton` attribute — show the filter dropdown in the UI.
    /// Defaults to true per ECMA-376.
    #[serde(default = "default_true")]
    pub show_button: bool,
}

impl Default for FilterColumn {
    fn default() -> Self {
        Self {
            col_index: 0,
            filter_type: None,
            hidden_button: false,
            show_button: true,
        }
    }
}

fn default_true() -> bool {
    true
}

/// OOXML filter type variants — the choice group inside CT_FilterColumn.
///
/// NOT to be confused with `FilterKind` (AutoFilter/TableFilter/AdvancedFilter).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum OoxmlFilterType {
    /// Value-based filter (CT_Filters, §18.3.2.8).
    Values {
        values: Vec<String>,
        #[serde(default)]
        blanks: bool,
        /// `calendarType` attribute on `<filters>`. Typed OOXML preservation: —
        /// previously dropped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        calendar_type: Option<CalendarType>,
        /// `<dateGroupItem>` children for date-grouped filters. Typed OOXML preservation:
        /// row 5.2 — previously dropped.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        date_group_items: Vec<DateGroupItem>,
    },
    /// Top / Bottom N filter (CT_Top10, §18.3.2.10).
    Top10 {
        top: bool,
        percent: bool,
        value: f64,
        /// `filterVal` attribute — application-computed filter threshold.
        /// Typed OOXML preservation: — previously dropped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filter_val: Option<f64>,
    },
    /// Custom filter (CT_CustomFilters, §18.3.2.2).
    Custom {
        conditions: Vec<OoxmlFilterCondition>,
        and_logic: bool,
    },
    /// Dynamic filter (CT_DynamicFilter, §18.3.2.5).
    Dynamic {
        dynamic_type: String,
        /// Computed `val` attribute for range-based dynamic filters.
        /// Typed OOXML preservation: — previously dropped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<f64>,
        /// Computed `maxVal` attribute for range-based dynamic filters.
        /// Typed OOXML preservation: — previously dropped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_value: Option<f64>,
        /// ISO datetime `valIso` for date-based dynamic filters.
        /// Typed OOXML preservation: — previously dropped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value_iso: Option<String>,
        /// ISO datetime `maxValIso` for date-based dynamic filters.
        /// Typed OOXML preservation: — previously dropped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_value_iso: Option<String>,
    },
    /// Color filter (CT_ColorFilter, §18.3.2.1).
    ///
    /// Typed OOXML preservation: the prior `{ color: String, by_font: bool }` shape
    /// was lossy (it dropped `dxfId`, which is the ACTUAL way OOXML
    /// identifies which color to match — colors come from the dxf palette).
    /// Replaced with the faithful CT_ColorFilter shape. The `color: String`
    /// legacy variant is gone: when the runtime layer carries a color
    /// token, the export path converts to this typed form (and emits a
    /// dummy dxfId until full dxf palette integration lands).
    Color {
        /// `dxfId` attribute — index into the differential-format palette.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dxf_id: Option<u32>,
        /// `cellColor` attribute — true means sort by cell fill color,
        /// false means by font color. Defaults to true per ECMA-376.
        #[serde(default = "default_true")]
        cell_color: bool,
    },
    /// Icon filter (CT_IconFilter, §18.3.2.9). Typed OOXML preservation: — the
    /// prior domain type could not represent icon filters at all; the
    /// write-side fell through to an empty `Values` list.
    Icon {
        /// `iconSet` attribute — the icon set being filtered on.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon_set: Option<String>,
        /// `iconId` attribute — zero-based index within the icon set.
        icon_id: u32,
    },
}

/// OOXML `<dateGroupItem>` element (CT_DateGroupItem, §18.3.2.4).
///
/// Used by value filters to group dates by year/month/day/hour/min/sec.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DateGroupItem {
    /// Year component (always required).
    pub year: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub month: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hour: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minute: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub second: Option<u16>,
    /// `dateTimeGrouping` attribute — the granularity of the grouping.
    #[serde(default)]
    pub date_time_grouping: DateTimeGrouping,
}

/// `ST_DateTimeGrouping` (§18.18.15) — grouping granularity for date filters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DateTimeGrouping {
    #[default]
    Year,
    Month,
    Day,
    Hour,
    Minute,
    Second,
}

impl DateTimeGrouping {
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        match s {
            "year" => Some(Self::Year),
            "month" => Some(Self::Month),
            "day" => Some(Self::Day),
            "hour" => Some(Self::Hour),
            "minute" => Some(Self::Minute),
            "second" => Some(Self::Second),
            _ => None,
        }
    }

    pub fn to_ooxml_token(self) -> &'static str {
        match self {
            Self::Year => "year",
            Self::Month => "month",
            Self::Day => "day",
            Self::Hour => "hour",
            Self::Minute => "minute",
            Self::Second => "second",
        }
    }
}

/// `ST_CalendarType` (§18.18.3) — calendar system for date grouping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CalendarType {
    #[default]
    None,
    Gregorian,
    GregorianUs,
    Japan,
    Taiwan,
    Korea,
    Hijri,
    Thai,
    Hebrew,
    Saka,
    GregorianMeFrench,
    GregorianArabic,
    GregorianXlitEnglish,
    GregorianXlitFrench,
}

impl CalendarType {
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        match s {
            "none" => Some(Self::None),
            "gregorian" => Some(Self::Gregorian),
            "gregorianUs" => Some(Self::GregorianUs),
            "japan" => Some(Self::Japan),
            "taiwan" => Some(Self::Taiwan),
            "korea" => Some(Self::Korea),
            "hijri" => Some(Self::Hijri),
            "thai" => Some(Self::Thai),
            "hebrew" => Some(Self::Hebrew),
            "saka" => Some(Self::Saka),
            "gregorianMeFrench" => Some(Self::GregorianMeFrench),
            "gregorianArabic" => Some(Self::GregorianArabic),
            "gregorianXlitEnglish" => Some(Self::GregorianXlitEnglish),
            "gregorianXlitFrench" => Some(Self::GregorianXlitFrench),
            _ => None,
        }
    }

    pub fn to_ooxml_token(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Gregorian => "gregorian",
            Self::GregorianUs => "gregorianUs",
            Self::Japan => "japan",
            Self::Taiwan => "taiwan",
            Self::Korea => "korea",
            Self::Hijri => "hijri",
            Self::Thai => "thai",
            Self::Hebrew => "hebrew",
            Self::Saka => "saka",
            Self::GregorianMeFrench => "gregorianMeFrench",
            Self::GregorianArabic => "gregorianArabic",
            Self::GregorianXlitEnglish => "gregorianXlitEnglish",
            Self::GregorianXlitFrench => "gregorianXlitFrench",
        }
    }
}

/// OOXML filter condition (operator + typed cell-value operand(s)).
///
/// Typed OOXML preservation: retyped `value` / `value2` from `serde_json::Value` to
/// `CellValue` — the OOXML `<customFilter val="…"/>` attribute only ever
/// carries a number, string, or boolean, so the JSON blob was hiding a
/// narrower type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OoxmlFilterCondition {
    pub operator: String,
    pub value: CellValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value2: Option<CellValue>,
}

/// OOXML `<sortState>` element (CT_SortState, §18.3.1.92).
///
/// Typed OOXML preservation retyped this from a raw-XML sidecar on
/// sort state into a first-class domain field so
/// the writer no longer silently drops sort state when the blob is absent.
///
/// The `<sortState>` element is a closed XSD: every attribute and child is
/// modelled here, so the raw-XML passthrough is unnecessary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortState {
    /// Required `ref` attribute — the range the sort applies to (e.g. `A1:D20`).
    pub range_ref: String,
    /// Namespace declarations authored directly on `<sortState>`.
    ///
    /// These are XML lexical metadata rather than CT_SortState semantic fields,
    /// but producers sometimes place extension namespace declarations here.
    /// Preserve them on the typed node so parser/writer and Yrs import/export
    /// keep the complete authored element.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub namespace_attrs: Vec<(String, String)>,
    /// `columnSort` attribute — when true, sort operates column-wise rather
    /// than row-wise. Defaults to false.
    #[serde(default)]
    pub column_sort: bool,
    /// `caseSensitive` attribute — whether string comparison is case sensitive.
    /// Defaults to false.
    #[serde(default)]
    pub case_sensitive: bool,
    /// `sortMethod` attribute — CJK sort method (stroke / pinYin / none).
    /// Defaults to `None`.
    #[serde(default)]
    pub sort_method: SortMethod,
    /// Zero or more child `<sortCondition>` elements.
    #[serde(default)]
    pub conditions: Vec<SortCondition>,
}

impl Default for SortState {
    fn default() -> Self {
        Self {
            range_ref: String::new(),
            namespace_attrs: Vec::new(),
            column_sort: false,
            case_sensitive: false,
            sort_method: SortMethod::None,
            conditions: Vec::new(),
        }
    }
}

/// OOXML `<sortCondition>` element (CT_SortCondition, §18.3.1.91).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortCondition {
    /// Required `ref` attribute — the range this single condition applies to.
    pub range_ref: String,
    /// `descending` attribute. Defaults to false (ascending).
    #[serde(default)]
    pub descending: bool,
    /// `sortBy` attribute — what to sort on (value / cellColor / fontColor /
    /// icon). Defaults to `Value`.
    #[serde(default)]
    pub sort_by: SortConditionBy,
    /// `customList` attribute — pipe-separated custom sort list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_list: Option<String>,
    /// `dxfId` attribute — differential formatting record index used when
    /// sorting by cell/font color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
    /// `iconSet` attribute — icon set used when sorting by icon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<IconSetType>,
    /// `iconId` attribute — zero-based index into the icon set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<u32>,
}

impl Default for SortCondition {
    fn default() -> Self {
        Self {
            range_ref: String::new(),
            descending: false,
            sort_by: SortConditionBy::Value,
            custom_list: None,
            dxf_id: None,
            icon_set: None,
            icon_id: None,
        }
    }
}

/// `ST_SortMethod` (§18.18.72) — CJK sort method on `<sortState>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortMethod {
    /// No specific sort method (default).
    #[default]
    None,
    /// Sort by stroke count (CJK).
    Stroke,
    /// Sort by PinYin (CJK).
    PinYin,
}

impl SortMethod {
    /// Parse from an OOXML attribute token.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        match s {
            "none" => Some(SortMethod::None),
            "stroke" => Some(SortMethod::Stroke),
            "pinYin" => Some(SortMethod::PinYin),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute token.
    pub fn to_ooxml_token(self) -> &'static str {
        match self {
            SortMethod::None => "none",
            SortMethod::Stroke => "stroke",
            SortMethod::PinYin => "pinYin",
        }
    }
}

/// `ST_SortBy` (§18.18.71) — what a `<sortCondition>` sorts on.
///
/// Distinct from the runtime `SortBy` enum below, which collapses
/// `cellColor`/`fontColor` onto a single `Color` variant for simpler UI state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortConditionBy {
    /// Sort by value (default).
    #[default]
    Value,
    /// Sort by cell fill color (resolved via `dxfId`).
    CellColor,
    /// Sort by font color (resolved via `dxfId`).
    FontColor,
    /// Sort by conditional-formatting icon (resolved via `iconSet` + `iconId`).
    Icon,
}

impl SortConditionBy {
    /// Parse from an OOXML attribute token.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        match s {
            "value" => Some(SortConditionBy::Value),
            "cellColor" => Some(SortConditionBy::CellColor),
            "fontColor" => Some(SortConditionBy::FontColor),
            "icon" => Some(SortConditionBy::Icon),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute token.
    pub fn to_ooxml_token(self) -> &'static str {
        match self {
            SortConditionBy::Value => "value",
            SortConditionBy::CellColor => "cellColor",
            SortConditionBy::FontColor => "fontColor",
            SortConditionBy::Icon => "icon",
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
// Runtime Filter Types (canonical — stored in Yrs, used by compute engine)
// ══════════════════════════════════════════════════════════════════════

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

/// CellId-backed criteria range for an in-place Advanced Filter.
///
/// The three fields are deliberately grouped so the durable filter contract
/// cannot carry partial criteria metadata. `None` means no criteria range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterCriteriaRange {
    pub sheet_id: String,
    pub start_cell_id: String,
    pub end_cell_id: String,
}

/// Advanced Filter metadata stored on canonical [`FilterState`] records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub criteria_range: Option<AdvancedFilterCriteriaRange>,
    #[serde(default)]
    pub unique_records_only: bool,
}

/// User-facing Advanced Filter mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedFilterMode {
    InPlace,
    CopyTo,
}

/// Bridge/API request for Rust-backed Advanced Filter application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterRequest {
    pub list_range: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criteria_range: Option<String>,
    pub mode: AdvancedFilterMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy_to_range: Option<String>,
    #[serde(default)]
    pub unique_records_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_id: Option<String>,
}

/// Receipt stored in `MutationResult.data` for Advanced Filter writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterResult {
    pub mode: AdvancedFilterMode,
    pub list_range: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criteria_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_id: Option<String>,
    pub rows_matched: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_hidden: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_copied: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns_copied: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_range: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════
// From conversions: ooxml_types sort types <-> domain sort types
// ══════════════════════════════════════════════════════════════════════

impl From<ooxml_types::tables::SortOrder> for SortOrder {
    fn from(order: ooxml_types::tables::SortOrder) -> Self {
        match order {
            ooxml_types::tables::SortOrder::Ascending => SortOrder::Asc,
            // Both None and Descending map; None defaults to Asc (ascending is the default sort).
            ooxml_types::tables::SortOrder::None => SortOrder::Asc,
            ooxml_types::tables::SortOrder::Descending => SortOrder::Desc,
        }
    }
}

impl From<SortOrder> for ooxml_types::tables::SortOrder {
    fn from(order: SortOrder) -> Self {
        match order {
            SortOrder::Asc => ooxml_types::tables::SortOrder::Ascending,
            SortOrder::Desc => ooxml_types::tables::SortOrder::Descending,
        }
    }
}

impl From<ooxml_types::tables::SortBy> for SortBy {
    fn from(sort_by: ooxml_types::tables::SortBy) -> Self {
        match sort_by {
            ooxml_types::tables::SortBy::Value => SortBy::Value,
            // CellColor and FontColor both collapse to Color in the runtime model.
            ooxml_types::tables::SortBy::CellColor | ooxml_types::tables::SortBy::FontColor => {
                SortBy::Color
            }
            ooxml_types::tables::SortBy::Icon => SortBy::Icon,
        }
    }
}

impl From<SortBy> for ooxml_types::tables::SortBy {
    fn from(sort_by: SortBy) -> Self {
        match sort_by {
            SortBy::Value => ooxml_types::tables::SortBy::Value,
            // Color expands to CellColor as the default (most common case).
            SortBy::Color => ooxml_types::tables::SortBy::CellColor,
            SortBy::Icon => ooxml_types::tables::SortBy::Icon,
        }
    }
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

// ══════════════════════════════════════════════════════════════════════
// AutoFilter ↔ FilterState conversions
// ══════════════════════════════════════════════════════════════════════

/// Parse an A1-style range reference like "A1:D20" into (start_row, start_col, end_row, end_col).
/// Returns 0-based indices.
fn parse_range_ref(range_ref: &str) -> Option<(u32, u32, u32, u32)> {
    let parts: Vec<&str> = range_ref.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let (r1, c1) = parse_cell_ref(parts[0])?;
    let (r2, c2) = parse_cell_ref(parts[1])?;
    Some((r1, c1, r2, c2))
}

/// Parse a cell reference like "A1" or "D20" into (row, col) 0-based.
fn parse_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let cell_ref = cell_ref.replace('$', ""); // strip absolute markers
    let mut col_str = String::new();
    let mut row_str = String::new();
    for ch in cell_ref.chars() {
        if ch.is_ascii_alphabetic() {
            col_str.push(ch);
        } else if ch.is_ascii_digit() {
            row_str.push(ch);
        }
    }
    if col_str.is_empty() || row_str.is_empty() {
        return None;
    }
    let col = col_letters_to_index(&col_str)?;
    let row = row_str.parse::<u32>().ok()?.checked_sub(1)?; // 1-based to 0-based
    Some((row, col))
}

/// Convert column letters (A, B, ..., Z, AA, AB, ...) to 0-based index.
fn col_letters_to_index(letters: &str) -> Option<u32> {
    let mut result: u32 = 0;
    for ch in letters.to_uppercase().chars() {
        let digit = (ch as u32).checked_sub('A' as u32)? + 1;
        result = result.checked_mul(26)?.checked_add(digit)?;
    }
    result.checked_sub(1)
}

/// Convert a 0-based column index to column letters (0 -> "A", 25 -> "Z", 26 -> "AA").
fn col_index_to_letters(mut col: u32) -> String {
    let mut result = String::new();
    loop {
        result.insert(0, (b'A' + (col % 26) as u8) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    result
}

/// Build an A1-style range ref from (start_row, start_col, end_row, end_col) 0-based.
fn build_range_ref(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    format!(
        "{}{}:{}{}",
        col_index_to_letters(start_col),
        start_row + 1,
        col_index_to_letters(end_col),
        end_row + 1,
    )
}

/// Convert an OOXML `AutoFilter` to a runtime `FilterState`.
///
/// The `cell_id_resolver` maps (row, col) to a CellId string (hex).
/// Typically this comes from the grid index's posToId map.
pub fn auto_filter_to_filter_state(
    auto_filter: &AutoFilter,
    cell_id_resolver: &impl Fn(u32, u32) -> Option<String>,
) -> Option<FilterState> {
    let (start_row, start_col, end_row, end_col) = parse_range_ref(&auto_filter.range_ref)?;

    let header_start_id = cell_id_resolver(start_row, start_col)?;
    let header_end_id = cell_id_resolver(start_row, end_col)?;
    let data_end_id = cell_id_resolver(end_row, end_col)?;

    let mut column_filters = HashMap::new();
    for fc in &auto_filter.columns {
        let Some(filter_type) = &fc.filter_type else {
            continue;
        };
        let col = start_col + fc.col_index;
        if let Some(header_cell_id) = cell_id_resolver(start_row, col) {
            let cf = ooxml_filter_type_to_column_filter(filter_type);
            column_filters.insert(header_cell_id, cf);
        }
    }

    Some(FilterState {
        id: format!("filter-{}", NEXT_FILTER_ID.fetch_add(1, Ordering::Relaxed)),
        filter_kind: FilterKind::AutoFilter,
        header_start_cell_id: header_start_id,
        header_end_cell_id: header_end_id,
        data_end_cell_id: data_end_id,
        column_filters,
        advanced_filter: None,
        sort_state: None, // TODO: convert SortState if needed
        table_id: None,
        created_at: None,
        updated_at: None,
        start_row: None,
        start_col: None,
        end_row: None,
        end_col: None,
    })
}

/// Convert an `OoxmlFilterType` variant to a `ColumnFilter`.
fn ooxml_filter_type_to_column_filter(ft: &OoxmlFilterType) -> ColumnFilter {
    match ft {
        OoxmlFilterType::Values { values, blanks, .. } => ColumnFilter::Values {
            values: values
                .iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect(),
            include_blanks: *blanks,
        },
        OoxmlFilterType::Top10 {
            top,
            percent,
            value,
            ..
        } => ColumnFilter::TopBottom {
            direction: if *top {
                TopBottomDirection::Top
            } else {
                TopBottomDirection::Bottom
            },
            count: *value,
            by: if *percent {
                TopBottomBy::Percent
            } else {
                TopBottomBy::Items
            },
        },
        OoxmlFilterType::Custom {
            conditions,
            and_logic,
        } => ColumnFilter::Condition {
            conditions: conditions
                .iter()
                .map(|c| FilterCondition {
                    operator: parse_ooxml_operator(&c.operator),
                    value: if matches!(c.value, CellValue::Null) {
                        None
                    } else {
                        Some(c.value.clone())
                    },
                    value2: c.value2.clone(),
                })
                .collect(),
            logic: if *and_logic {
                FilterLogic::And
            } else {
                FilterLogic::Or
            },
        },
        OoxmlFilterType::Dynamic { dynamic_type, .. } => ColumnFilter::Dynamic {
            rule: parse_dynamic_type(dynamic_type),
        },
        OoxmlFilterType::Color { dxf_id, cell_color } => ColumnFilter::Color {
            // The runtime ColumnFilter::Color predates typed OOXML preservation's typing work
            // and carries a string `color` token (a dxfId is the canonical
            // OOXML representation but the runtime hasn't been migrated yet).
            // Preserve the dxfId as a string so export can round-trip it
            // back into the typed Color variant via `format!` parsing below.
            color: dxf_id.map(|id| format!("dxf:{id}")).unwrap_or_default(),
            by_font: !*cell_color,
        },
        OoxmlFilterType::Icon { icon_set, icon_id } => ColumnFilter::Icon {
            icon_set_name: icon_set.clone().unwrap_or_default(),
            icon_index: *icon_id as u8,
        },
    }
}

/// Parse an OOXML operator string to FilterOperator.
fn parse_ooxml_operator(op: &str) -> FilterOperator {
    match op {
        "equal" | "equals" => FilterOperator::Equals,
        "notEqual" | "notEquals" => FilterOperator::NotEquals,
        "greaterThan" => FilterOperator::GreaterThan,
        "greaterThanOrEqual" => FilterOperator::GreaterThanOrEqual,
        "lessThan" => FilterOperator::LessThan,
        "lessThanOrEqual" => FilterOperator::LessThanOrEqual,
        "beginsWith" | "startsWith" => FilterOperator::BeginsWith,
        "endsWith" => FilterOperator::EndsWith,
        "contains" => FilterOperator::Contains,
        "notContains" => FilterOperator::NotContains,
        "between" => FilterOperator::Between,
        "notBetween" => FilterOperator::NotBetween,
        _ => FilterOperator::Equals, // fallback for unknown OOXML operators
    }
}

/// Parse a dynamic type string from OOXML to a DynamicFilterRule.
fn parse_dynamic_type(dt: &str) -> DynamicFilterRule {
    match dt {
        "aboveAverage" => DynamicFilterRule::AboveAverage,
        "belowAverage" => DynamicFilterRule::BelowAverage,
        "today" => DynamicFilterRule::Today,
        "yesterday" => DynamicFilterRule::Yesterday,
        "tomorrow" => DynamicFilterRule::Tomorrow,
        "thisWeek" => DynamicFilterRule::ThisWeek,
        "lastWeek" => DynamicFilterRule::LastWeek,
        "nextWeek" => DynamicFilterRule::NextWeek,
        "thisMonth" => DynamicFilterRule::ThisMonth,
        "lastMonth" => DynamicFilterRule::LastMonth,
        "nextMonth" => DynamicFilterRule::NextMonth,
        "thisQuarter" => DynamicFilterRule::ThisQuarter,
        "lastQuarter" => DynamicFilterRule::LastQuarter,
        "nextQuarter" => DynamicFilterRule::NextQuarter,
        "thisYear" => DynamicFilterRule::ThisYear,
        "lastYear" => DynamicFilterRule::LastYear,
        "nextYear" => DynamicFilterRule::NextYear,
        _ => DynamicFilterRule::AboveAverage, // fallback for unrecognized types
    }
}

/// Convert a runtime `FilterState` back to an OOXML `AutoFilter` for export.
///
/// The `pos_resolver` maps a CellId string (hex) to (row, col).
pub fn filter_state_to_auto_filter(
    state: &FilterState,
    pos_resolver: &impl Fn(&str) -> Option<(u32, u32)>,
) -> Option<AutoFilter> {
    let (start_row, start_col) = pos_resolver(&state.header_start_cell_id)?;
    let (end_row, end_col) = pos_resolver(&state.data_end_cell_id)?;

    let range_ref = build_range_ref(start_row, start_col, end_row, end_col);

    let mut columns: Vec<FilterColumn> = Vec::new();
    for (cell_id, cf) in &state.column_filters {
        if let Some((_, col)) = pos_resolver(cell_id) {
            let col_index = col.saturating_sub(start_col);
            let filter_type = Some(column_filter_to_ooxml(cf));
            columns.push(FilterColumn {
                col_index,
                filter_type,
                ..Default::default()
            });
        }
    }
    columns.sort_by_key(|c| c.col_index);

    Some(AutoFilter {
        range_ref,
        columns,
        sort: None, // TODO: convert FilterSortState back to SortState
        xr_uid: None,
    })
}

/// Convert a `ColumnFilter` back to an `OoxmlFilterType`.
fn column_filter_to_ooxml(cf: &ColumnFilter) -> OoxmlFilterType {
    match cf {
        ColumnFilter::Values {
            values,
            include_blanks,
        } => OoxmlFilterType::Values {
            values: values
                .iter()
                .map(|v| match v {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b) => b.to_string(),
                    _ => String::new(),
                })
                .filter(|s| !s.is_empty())
                .collect(),
            blanks: *include_blanks,
            calendar_type: None,
            date_group_items: Vec::new(),
        },
        ColumnFilter::TopBottom {
            direction,
            count,
            by,
        } => OoxmlFilterType::Top10 {
            top: *direction == TopBottomDirection::Top,
            percent: *by == TopBottomBy::Percent,
            value: *count,
            filter_val: None,
        },
        ColumnFilter::Condition { conditions, logic } => OoxmlFilterType::Custom {
            conditions: conditions
                .iter()
                .map(|c| OoxmlFilterCondition {
                    operator: format_filter_operator(&c.operator),
                    value: c.value.clone().unwrap_or(CellValue::Null),
                    value2: c.value2.clone(),
                })
                .collect(),
            and_logic: *logic == FilterLogic::And,
        },
        ColumnFilter::Dynamic { rule } => OoxmlFilterType::Dynamic {
            dynamic_type: format_dynamic_rule(rule),
            value: None,
            max_value: None,
            value_iso: None,
            max_value_iso: None,
        },
        ColumnFilter::Color { color, by_font } => OoxmlFilterType::Color {
            // Decode the `dxf:<id>` shim used to carry the dxfId through the
            // runtime `ColumnFilter::Color` variant (see the inverse in
            // `ooxml_filter_type_to_column_filter`). Plain color strings
            // (legacy) are dropped onto `dxf_id: None` until the runtime
            // layer adopts dxfId directly.
            dxf_id: color
                .strip_prefix("dxf:")
                .and_then(|s| s.parse::<u32>().ok()),
            cell_color: !*by_font,
        },
        ColumnFilter::Icon {
            icon_set_name,
            icon_index,
        } => OoxmlFilterType::Icon {
            icon_set: if icon_set_name.is_empty() {
                None
            } else {
                Some(icon_set_name.clone())
            },
            icon_id: *icon_index as u32,
        },
    }
}

/// Format a FilterOperator as an OOXML operator string.
fn format_filter_operator(op: &FilterOperator) -> String {
    match op {
        FilterOperator::Equals => "equal".to_string(),
        FilterOperator::NotEquals => "notEqual".to_string(),
        FilterOperator::GreaterThan => "greaterThan".to_string(),
        FilterOperator::GreaterThanOrEqual => "greaterThanOrEqual".to_string(),
        FilterOperator::LessThan => "lessThan".to_string(),
        FilterOperator::LessThanOrEqual => "lessThanOrEqual".to_string(),
        FilterOperator::BeginsWith => "beginsWith".to_string(),
        FilterOperator::EndsWith => "endsWith".to_string(),
        FilterOperator::Contains => "contains".to_string(),
        FilterOperator::NotContains => "notContains".to_string(),
        FilterOperator::Between => "between".to_string(),
        FilterOperator::NotBetween => "notBetween".to_string(),
        FilterOperator::IsBlank => "equal".to_string(), // OOXML uses blank value, not operator
        FilterOperator::IsNotBlank => "notEqual".to_string(),
        FilterOperator::AboveAverage => "equal".to_string(), // dynamic, not custom operator in OOXML
        FilterOperator::BelowAverage => "equal".to_string(),
    }
}

/// Format a DynamicFilterRule as an OOXML camelCase string.
fn format_dynamic_rule(rule: &DynamicFilterRule) -> String {
    match rule {
        DynamicFilterRule::AboveAverage => "aboveAverage".to_string(),
        DynamicFilterRule::BelowAverage => "belowAverage".to_string(),
        DynamicFilterRule::Today => "today".to_string(),
        DynamicFilterRule::Yesterday => "yesterday".to_string(),
        DynamicFilterRule::Tomorrow => "tomorrow".to_string(),
        DynamicFilterRule::ThisWeek => "thisWeek".to_string(),
        DynamicFilterRule::LastWeek => "lastWeek".to_string(),
        DynamicFilterRule::NextWeek => "nextWeek".to_string(),
        DynamicFilterRule::ThisMonth => "thisMonth".to_string(),
        DynamicFilterRule::LastMonth => "lastMonth".to_string(),
        DynamicFilterRule::NextMonth => "nextMonth".to_string(),
        DynamicFilterRule::ThisQuarter => "thisQuarter".to_string(),
        DynamicFilterRule::LastQuarter => "lastQuarter".to_string(),
        DynamicFilterRule::NextQuarter => "nextQuarter".to_string(),
        DynamicFilterRule::ThisYear => "thisYear".to_string(),
        DynamicFilterRule::LastYear => "lastYear".to_string(),
        DynamicFilterRule::NextYear => "nextYear".to_string(),
    }
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_filter_values_roundtrip() {
        let filter = ColumnFilter::Values {
            values: vec![
                serde_json::json!("a"),
                serde_json::json!(1),
                serde_json::json!(null),
            ],
            include_blanks: true,
        };
        let json = serde_json::to_string(&filter).unwrap();
        let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(filter, reparsed);
    }

    #[test]
    fn column_filter_condition_roundtrip() {
        let filter = ColumnFilter::Condition {
            conditions: vec![FilterCondition {
                operator: FilterOperator::GreaterThan,
                value: Some(CellValue::number(10.0)),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
        let json = serde_json::to_string(&filter).unwrap();
        let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(filter, reparsed);
    }

    #[test]
    fn column_filter_top_bottom_roundtrip() {
        let filter = ColumnFilter::TopBottom {
            direction: TopBottomDirection::Top,
            count: 10.0,
            by: TopBottomBy::Items,
        };
        let json = serde_json::to_string(&filter).unwrap();
        let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(filter, reparsed);
    }

    #[test]
    fn column_filter_dynamic_roundtrip() {
        let filter = ColumnFilter::Dynamic {
            rule: DynamicFilterRule::AboveAverage,
        };
        let json = serde_json::to_string(&filter).unwrap();
        let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(filter, reparsed);
    }

    #[test]
    fn column_filter_color_roundtrip() {
        // Note: `ColumnFilter::Color` is the runtime (Yrs-stored) shape, not
        // the OOXML-typed `OoxmlFilterType::Color`. The `color` token here
        // is a free-form string the UI assigns; typed OOXML preservation did not migrate
        // this runtime shape (see `ooxml_filter_type_to_column_filter` for
        // the `dxf:<id>` shim used to bridge the two).
        let filter = ColumnFilter::Color {
            color: "#ff0000".to_string(),
            by_font: false,
        };
        let json = serde_json::to_string(&filter).unwrap();
        let reparsed: ColumnFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(filter, reparsed);
    }

    #[test]
    fn filter_state_roundtrip() {
        let state = FilterState {
            id: "f1".to_string(),
            filter_kind: FilterKind::AutoFilter,
            header_start_cell_id: "c1".to_string(),
            header_end_cell_id: "c2".to_string(),
            data_end_cell_id: "c3".to_string(),
            column_filters: {
                let mut m = HashMap::new();
                m.insert(
                    "c1".to_string(),
                    ColumnFilter::Values {
                        values: vec![serde_json::json!("a"), serde_json::json!(1)],
                        include_blanks: false,
                    },
                );
                m
            },
            advanced_filter: None,
            sort_state: Some(FilterSortState {
                column_cell_id: "c1".to_string(),
                order: SortOrder::Asc,
                sort_by: SortBy::Value,
            }),
            table_id: None,
            created_at: Some(1000),
            updated_at: Some(2000),
            start_row: None,
            start_col: None,
            end_row: None,
            end_col: None,
        };
        let json = serde_json::to_string(&state).unwrap();
        let reparsed: FilterState = serde_json::from_str(&json).unwrap();
        assert_eq!(state.id, reparsed.id);
        assert_eq!(state.filter_kind, reparsed.filter_kind);
        assert_eq!(state.column_filters, reparsed.column_filters);
        assert_eq!(state.sort_state, reparsed.sort_state);
    }

    #[test]
    fn filter_kind_serde() {
        assert_eq!(
            serde_json::to_string(&FilterKind::AutoFilter).unwrap(),
            "\"autoFilter\""
        );
        assert_eq!(
            serde_json::to_string(&FilterKind::TableFilter).unwrap(),
            "\"tableFilter\""
        );
    }

    #[test]
    fn filter_operator_serde() {
        assert_eq!(
            serde_json::to_string(&FilterOperator::Equals).unwrap(),
            "\"equals\""
        );
        assert_eq!(
            serde_json::to_string(&FilterOperator::GreaterThanOrEqual).unwrap(),
            "\"greaterThanOrEqual\""
        );
        assert_eq!(
            serde_json::to_string(&FilterOperator::IsBlank).unwrap(),
            "\"isBlank\""
        );
    }

    #[test]
    fn test_parse_range_ref() {
        assert_eq!(parse_range_ref("A1:D20"), Some((0, 0, 19, 3)));
        assert_eq!(parse_range_ref("$B$2:$E$10"), Some((1, 1, 9, 4)));
        assert_eq!(parse_range_ref("AA1:AB5"), Some((0, 26, 4, 27)));
    }

    #[test]
    fn test_col_letters_roundtrip() {
        assert_eq!(col_letters_to_index("A"), Some(0));
        assert_eq!(col_letters_to_index("Z"), Some(25));
        assert_eq!(col_letters_to_index("AA"), Some(26));
        assert_eq!(col_index_to_letters(0), "A");
        assert_eq!(col_index_to_letters(25), "Z");
        assert_eq!(col_index_to_letters(26), "AA");
    }

    #[test]
    fn test_auto_filter_to_filter_state() {
        let af = AutoFilter {
            range_ref: "A1:C10".to_string(),
            columns: vec![FilterColumn {
                col_index: 0,
                filter_type: Some(OoxmlFilterType::Values {
                    values: vec!["Alice".to_string(), "Bob".to_string()],
                    blanks: false,
                    calendar_type: None,
                    date_group_items: Vec::new(),
                }),
                ..Default::default()
            }],
            sort: None,
            xr_uid: None,
        };
        let resolver =
            |row: u32, col: u32| -> Option<String> { Some(format!("cell-{}-{}", row, col)) };
        let state = auto_filter_to_filter_state(&af, &resolver).unwrap();
        assert_eq!(state.filter_kind, FilterKind::AutoFilter);
        assert_eq!(state.header_start_cell_id, "cell-0-0");
        assert_eq!(state.header_end_cell_id, "cell-0-2");
        assert_eq!(state.data_end_cell_id, "cell-9-2");
        assert_eq!(state.column_filters.len(), 1);
        let cf = state.column_filters.get("cell-0-0").unwrap();
        match cf {
            ColumnFilter::Values {
                values,
                include_blanks,
            } => {
                assert_eq!(values.len(), 2);
                assert!(!include_blanks);
            }
            _ => panic!("Expected Values variant"),
        }
    }

    #[test]
    fn test_auto_filter_to_filter_state_skips_childless_columns() {
        let af = AutoFilter {
            range_ref: "A1:C10".to_string(),
            columns: vec![
                FilterColumn {
                    col_index: 0,
                    filter_type: None,
                    ..Default::default()
                },
                FilterColumn {
                    col_index: 1,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: Vec::new(),
                        blanks: false,
                        calendar_type: None,
                        date_group_items: Vec::new(),
                    }),
                    ..Default::default()
                },
            ],
            sort: None,
            xr_uid: None,
        };
        let resolver =
            |row: u32, col: u32| -> Option<String> { Some(format!("cell-{}-{}", row, col)) };
        let state = auto_filter_to_filter_state(&af, &resolver).unwrap();
        assert_eq!(state.header_start_cell_id, "cell-0-0");
        assert_eq!(state.header_end_cell_id, "cell-0-2");
        assert_eq!(state.data_end_cell_id, "cell-9-2");
        assert!(!state.column_filters.contains_key("cell-0-0"));
        assert!(state.column_filters.contains_key("cell-0-1"));
    }

    #[test]
    fn test_filter_state_to_auto_filter_roundtrip() {
        let af = AutoFilter {
            range_ref: "B2:D10".to_string(),
            columns: vec![
                FilterColumn {
                    col_index: 0,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: vec!["X".to_string()],
                        blanks: true,
                        calendar_type: None,
                        date_group_items: Vec::new(),
                    }),
                    ..Default::default()
                },
                FilterColumn {
                    col_index: 2,
                    filter_type: Some(OoxmlFilterType::Top10 {
                        top: true,
                        percent: false,
                        value: 5.0,
                        filter_val: None,
                    }),
                    ..Default::default()
                },
            ],
            sort: None,
            xr_uid: None,
        };
        let resolver =
            |row: u32, col: u32| -> Option<String> { Some(format!("c-{}-{}", row, col)) };
        let state = auto_filter_to_filter_state(&af, &resolver).unwrap();

        let pos_resolver = |cell_id: &str| -> Option<(u32, u32)> {
            let parts: Vec<&str> = cell_id.strip_prefix("c-")?.split('-').collect();
            Some((parts[0].parse().ok()?, parts[1].parse().ok()?))
        };
        let af2 = filter_state_to_auto_filter(&state, &pos_resolver).unwrap();
        assert_eq!(af2.range_ref, "B2:D10");
        assert_eq!(af2.columns.len(), 2);
        assert_eq!(af2.columns[0].col_index, 0);
        assert_eq!(af2.columns[1].col_index, 2);
    }

    #[test]
    fn ooxml_filter_condition_updated() {
        let cond = OoxmlFilterCondition {
            operator: "greaterThan".to_string(),
            value: CellValue::number(42.0),
            value2: None,
        };
        let json = serde_json::to_string(&cond).unwrap();
        assert!(json.contains("42"));
        let reparsed: OoxmlFilterCondition = serde_json::from_str(&json).unwrap();
        assert_eq!(cond, reparsed);
    }

    // ── From conversion tests: ooxml_types <-> domain sort types ──

    #[test]
    fn sort_order_from_ooxml_ascending() {
        let result: SortOrder = ooxml_types::tables::SortOrder::Ascending.into();
        assert_eq!(result, SortOrder::Asc);
    }

    #[test]
    fn sort_order_from_ooxml_descending() {
        let result: SortOrder = ooxml_types::tables::SortOrder::Descending.into();
        assert_eq!(result, SortOrder::Desc);
    }

    #[test]
    fn sort_order_from_ooxml_none_defaults_to_asc() {
        let result: SortOrder = ooxml_types::tables::SortOrder::None.into();
        assert_eq!(result, SortOrder::Asc);
    }

    #[test]
    fn sort_order_to_ooxml_roundtrip() {
        let asc: ooxml_types::tables::SortOrder = SortOrder::Asc.into();
        assert_eq!(asc, ooxml_types::tables::SortOrder::Ascending);

        let desc: ooxml_types::tables::SortOrder = SortOrder::Desc.into();
        assert_eq!(desc, ooxml_types::tables::SortOrder::Descending);
    }

    #[test]
    fn sort_by_from_ooxml_value() {
        let result: SortBy = ooxml_types::tables::SortBy::Value.into();
        assert_eq!(result, SortBy::Value);
    }

    #[test]
    fn sort_by_from_ooxml_cell_color() {
        let result: SortBy = ooxml_types::tables::SortBy::CellColor.into();
        assert_eq!(result, SortBy::Color);
    }

    #[test]
    fn sort_by_from_ooxml_font_color() {
        let result: SortBy = ooxml_types::tables::SortBy::FontColor.into();
        assert_eq!(result, SortBy::Color);
    }

    #[test]
    fn sort_by_from_ooxml_icon() {
        let result: SortBy = ooxml_types::tables::SortBy::Icon.into();
        assert_eq!(result, SortBy::Icon);
    }

    #[test]
    fn sort_by_to_ooxml_roundtrip() {
        let value: ooxml_types::tables::SortBy = SortBy::Value.into();
        assert_eq!(value, ooxml_types::tables::SortBy::Value);

        let color: ooxml_types::tables::SortBy = SortBy::Color.into();
        assert_eq!(color, ooxml_types::tables::SortBy::CellColor);

        let icon: ooxml_types::tables::SortBy = SortBy::Icon.into();
        assert_eq!(icon, ooxml_types::tables::SortBy::Icon);
    }

    // ── Serde wire format tests (bridge compatibility) ──

    #[test]
    fn sort_order_serde_wire_format() {
        // Must produce "asc"/"desc" to match what the TS bridge sends
        assert_eq!(serde_json::to_string(&SortOrder::Asc).unwrap(), "\"asc\"");
        assert_eq!(serde_json::to_string(&SortOrder::Desc).unwrap(), "\"desc\"");

        // Must deserialize from those same strings
        let asc: SortOrder = serde_json::from_str("\"asc\"").unwrap();
        assert_eq!(asc, SortOrder::Asc);
        let desc: SortOrder = serde_json::from_str("\"desc\"").unwrap();
        assert_eq!(desc, SortOrder::Desc);
    }

    #[test]
    fn sort_by_serde_wire_format() {
        // Must produce "value"/"color"/"icon" to match what the TS bridge sends
        assert_eq!(serde_json::to_string(&SortBy::Value).unwrap(), "\"value\"");
        assert_eq!(serde_json::to_string(&SortBy::Color).unwrap(), "\"color\"");
        assert_eq!(serde_json::to_string(&SortBy::Icon).unwrap(), "\"icon\"");

        // Must deserialize from those same strings
        let value: SortBy = serde_json::from_str("\"value\"").unwrap();
        assert_eq!(value, SortBy::Value);
        let color: SortBy = serde_json::from_str("\"color\"").unwrap();
        assert_eq!(color, SortBy::Color);
        let icon: SortBy = serde_json::from_str("\"icon\"").unwrap();
        assert_eq!(icon, SortBy::Icon);
    }

    #[test]
    fn column_filter_values_preserves_camel_case_include_blanks() {
        let filter: ColumnFilter = serde_json::from_value(serde_json::json!({
            "type": "values",
            "values": [],
            "includeBlanks": true
        }))
        .unwrap();

        assert_eq!(
            filter,
            ColumnFilter::Values {
                values: Vec::new(),
                include_blanks: true,
            }
        );

        let wire = serde_json::to_value(&filter).unwrap();
        assert_eq!(wire["includeBlanks"], true);
        assert!(wire.get("include_blanks").is_none());
    }
}
