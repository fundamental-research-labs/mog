use serde::{Deserialize, Serialize};
use value_types::CellValue;

use super::ooxml_sort::SortState;

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
    /// Raw direct-child `<extLst>` owned by this autoFilter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_raw: Option<String>,
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
    /// Raw direct-child `<extLst>` owned by this filterColumn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_raw: Option<String>,
}

impl Default for FilterColumn {
    fn default() -> Self {
        Self {
            col_index: 0,
            filter_type: None,
            hidden_button: false,
            show_button: true,
            ext_lst_raw: None,
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
