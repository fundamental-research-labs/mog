// ============================================================================

/// Totals row function type (ST_TotalsRowFunction).
///
/// Specifies the function to apply in the totals row of a table column.
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
pub enum TotalsRowFunction {
    /// No function (default)
    #[default]
    #[xml("none")]
    None,
    /// Average function
    #[xml("average")]
    Average,
    /// Count function
    #[xml("count")]
    Count,
    /// Count numbers function
    #[xml("countNums")]
    CountNums,
    /// Maximum function
    #[xml("max")]
    Max,
    /// Minimum function
    #[xml("min")]
    Min,
    /// Standard deviation function
    #[xml("stdDev")]
    StdDev,
    /// Sum function
    #[xml("sum")]
    Sum,
    /// Variance function
    #[xml("var")]
    Var,
    /// Custom formula
    #[xml("custom")]
    Custom,
}
// ============================================================================

/// Table type (ST_TableType).
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
pub enum TableType {
    /// Worksheet table (default)
    #[default]
    #[xml("worksheet")]
    Worksheet,
    /// XML mapped table
    #[xml("xml")]
    Xml,
    /// Query table
    #[xml("queryTable")]
    QueryTable,
}

// ============================================================================
// SortOrder -- ST_SortBy (read-side sort direction)
// ============================================================================

/// Sort order for filter columns (ST_SortBy).
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
pub enum SortOrder {
    /// No specific sort order
    #[default]
    #[xml("none")]
    None,
    /// Sort ascending
    #[xml("ascending", alias = "asc")]
    Ascending,
    /// Sort descending
    #[xml("descending", alias = "desc")]
    Descending,
}

// ============================================================================
// SortBy -- ST_SortBy (write-side sort-by type)
// ============================================================================

/// Sort by type (ST_SortBy).
///
/// Specifies what attribute of the cell to sort by.
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
pub enum SortBy {
    /// Sort by value (default)
    #[default]
    #[xml("value")]
    Value,
    /// Sort by cell color
    #[xml("cellColor")]
    CellColor,
    /// Sort by font color
    #[xml("fontColor")]
    FontColor,
    /// Sort by icon
    #[xml("icon")]
    Icon,
}
