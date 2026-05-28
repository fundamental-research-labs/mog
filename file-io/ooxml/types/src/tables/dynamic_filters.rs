// ============================================================================

/// Dynamic filter type (ST_DynamicFilterType).
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
pub enum DynamicFilterType {
    /// No filter / null
    #[default]
    #[xml("null")]
    Null,
    /// Above average
    #[xml("aboveAverage")]
    AboveAverage,
    /// Below average
    #[xml("belowAverage")]
    BelowAverage,
    /// Tomorrow
    #[xml("tomorrow")]
    Tomorrow,
    /// Today
    #[xml("today")]
    Today,
    /// Yesterday
    #[xml("yesterday")]
    Yesterday,
    /// Next week
    #[xml("nextWeek")]
    NextWeek,
    /// This week
    #[xml("thisWeek")]
    ThisWeek,
    /// Last week
    #[xml("lastWeek")]
    LastWeek,
    /// Next month
    #[xml("nextMonth")]
    NextMonth,
    /// This month
    #[xml("thisMonth")]
    ThisMonth,
    /// Last month
    #[xml("lastMonth")]
    LastMonth,
    /// Next quarter
    #[xml("nextQuarter")]
    NextQuarter,
    /// This quarter
    #[xml("thisQuarter")]
    ThisQuarter,
    /// Last quarter
    #[xml("lastQuarter")]
    LastQuarter,
    /// Next year
    #[xml("nextYear")]
    NextYear,
    /// This year
    #[xml("thisYear")]
    ThisYear,
    /// Last year
    #[xml("lastYear")]
    LastYear,
    /// Year to date
    #[xml("yearToDate")]
    YearToDate,
    /// Q1
    #[xml("Q1")]
    Q1,
    /// Q2
    #[xml("Q2")]
    Q2,
    /// Q3
    #[xml("Q3")]
    Q3,
    /// Q4
    #[xml("Q4")]
    Q4,
    /// M1 (January)
    #[xml("M1")]
    M1,
    /// M2 (February)
    #[xml("M2")]
    M2,
    /// M3 (March)
    #[xml("M3")]
    M3,
    /// M4 (April)
    #[xml("M4")]
    M4,
    /// M5 (May)
    #[xml("M5")]
    M5,
    /// M6 (June)
    #[xml("M6")]
    M6,
    /// M7 (July)
    #[xml("M7")]
    M7,
    /// M8 (August)
    #[xml("M8")]
    M8,
    /// M9 (September)
    #[xml("M9")]
    M9,
    /// M10 (October)
    #[xml("M10")]
    M10,
    /// M11 (November)
    #[xml("M11")]
    M11,
    /// M12 (December)
    #[xml("M12")]
    M12,
}
// ============================================================================

/// Date/time grouping granularity (ST_DateTimeGrouping).
///
/// Specifies the level of date/time grouping for date-based filters.
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
