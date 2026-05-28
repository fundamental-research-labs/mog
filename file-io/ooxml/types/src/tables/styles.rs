// ============================================================================
// TableStyleInfo -- CT_TableStyleInfo
// ============================================================================

/// Table style information (CT_TableStyleInfo).
///
/// Shared by both the read and write paths.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct TableStyleInfo {
    /// Name of the table style (e.g., "TableStyleMedium9")
    pub name: Option<String>,
    /// Show first column formatting
    pub show_first_column: bool,
    /// Show last column formatting
    pub show_last_column: bool,
    /// Show row stripes
    pub show_row_stripes: bool,
    /// Show column stripes
    pub show_column_stripes: bool,
}

impl TableStyleInfo {
    /// Create a new table style with the given name and default options.
    #[must_use]
    pub fn new(name: &str) -> Self {
        Self {
            name: Some(name.to_string()),
            show_first_column: false,
            show_last_column: false,
            show_row_stripes: true,
            show_column_stripes: false,
        }
    }
}
// ============================================================================
// TableStyleType -- ST_TableStyleType
// ============================================================================

/// Table style element type (ST_TableStyleType, ECMA-376 §18.18.73).
///
/// Identifies which region of a table a style element applies to.
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
pub enum TableStyleType {
    /// Whole table style.
    #[default]
    #[xml("wholeTable")]
    WholeTable,
    /// Header row style.
    #[xml("headerRow")]
    HeaderRow,
    /// Total row style.
    #[xml("totalRow")]
    TotalRow,
    /// First column style.
    #[xml("firstColumn")]
    FirstColumn,
    /// Last column style.
    #[xml("lastColumn")]
    LastColumn,
    /// First row stripe style.
    #[xml("firstRowStripe")]
    FirstRowStripe,
    /// Second row stripe style.
    #[xml("secondRowStripe")]
    SecondRowStripe,
    /// First column stripe style.
    #[xml("firstColumnStripe")]
    FirstColumnStripe,
    /// Second column stripe style.
    #[xml("secondColumnStripe")]
    SecondColumnStripe,
    /// First header cell style.
    #[xml("firstHeaderCell")]
    FirstHeaderCell,
    /// Last header cell style.
    #[xml("lastHeaderCell")]
    LastHeaderCell,
    /// First total cell style.
    #[xml("firstTotalCell")]
    FirstTotalCell,
    /// Last total cell style.
    #[xml("lastTotalCell")]
    LastTotalCell,
    /// First subtotal column style.
    #[xml("firstSubtotalColumn")]
    FirstSubtotalColumn,
    /// Second subtotal column style.
    #[xml("secondSubtotalColumn")]
    SecondSubtotalColumn,
    /// Third subtotal column style.
    #[xml("thirdSubtotalColumn")]
    ThirdSubtotalColumn,
    /// First subtotal row style.
    #[xml("firstSubtotalRow")]
    FirstSubtotalRow,
    /// Second subtotal row style.
    #[xml("secondSubtotalRow")]
    SecondSubtotalRow,
    /// Third subtotal row style.
    #[xml("thirdSubtotalRow")]
    ThirdSubtotalRow,
    /// Blank row style.
    #[xml("blankRow")]
    BlankRow,
    /// First column subheading style.
    #[xml("firstColumnSubheading")]
    FirstColumnSubheading,
    /// Second column subheading style.
    #[xml("secondColumnSubheading")]
    SecondColumnSubheading,
    /// Third column subheading style.
    #[xml("thirdColumnSubheading")]
    ThirdColumnSubheading,
    /// First row subheading style.
    #[xml("firstRowSubheading")]
    FirstRowSubheading,
    /// Second row subheading style.
    #[xml("secondRowSubheading")]
    SecondRowSubheading,
    /// Third row subheading style.
    #[xml("thirdRowSubheading")]
    ThirdRowSubheading,
    /// Page field labels style.
    #[xml("pageFieldLabels")]
    PageFieldLabels,
    /// Page field values style.
    #[xml("pageFieldValues")]
    PageFieldValues,
}
