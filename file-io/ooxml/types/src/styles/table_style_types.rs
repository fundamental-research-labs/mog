// =============================================================================
// Table Style Type
// =============================================================================

/// Table style element type (ECMA-376 ST_TableStyleType).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum TableStyleType {
    /// Whole table
    WholeTable,
    /// Header row
    HeaderRow,
    /// Total row
    TotalRow,
    /// First column
    FirstColumn,
    /// Last column
    LastColumn,
    /// First row stripe
    FirstRowStripe,
    /// Second row stripe
    SecondRowStripe,
    /// First column stripe
    FirstColumnStripe,
    /// Second column stripe
    SecondColumnStripe,
    /// First header cell
    FirstHeaderCell,
    /// Last header cell
    LastHeaderCell,
    /// First total cell
    FirstTotalCell,
    /// Last total cell
    LastTotalCell,
    /// First subtotal column
    FirstSubtotalColumn,
    /// Second subtotal column
    SecondSubtotalColumn,
    /// Third subtotal column
    ThirdSubtotalColumn,
    /// First subtotal row
    FirstSubtotalRow,
    /// Second subtotal row
    SecondSubtotalRow,
    /// Third subtotal row
    ThirdSubtotalRow,
    /// Blank row
    BlankRow,
    /// First column subheading
    FirstColumnSubheading,
    /// Second column subheading
    SecondColumnSubheading,
    /// Third column subheading
    ThirdColumnSubheading,
    /// First row subheading
    FirstRowSubheading,
    /// Second row subheading
    SecondRowSubheading,
    /// Third row subheading
    ThirdRowSubheading,
    /// Page field labels
    PageFieldLabels,
    /// Page field values
    PageFieldValues,
}

impl TableStyleType {
    /// Parse from an OOXML attribute value.
    ///
    /// Returns `None` for unrecognised strings — unlike other style enums,
    /// unknown table style types should not silently default.
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "wholeTable" => Some(Self::WholeTable),
            "headerRow" => Some(Self::HeaderRow),
            "totalRow" => Some(Self::TotalRow),
            "firstColumn" => Some(Self::FirstColumn),
            "lastColumn" => Some(Self::LastColumn),
            "firstRowStripe" => Some(Self::FirstRowStripe),
            "secondRowStripe" => Some(Self::SecondRowStripe),
            "firstColumnStripe" => Some(Self::FirstColumnStripe),
            "secondColumnStripe" => Some(Self::SecondColumnStripe),
            "firstHeaderCell" => Some(Self::FirstHeaderCell),
            "lastHeaderCell" => Some(Self::LastHeaderCell),
            "firstTotalCell" => Some(Self::FirstTotalCell),
            "lastTotalCell" => Some(Self::LastTotalCell),
            "firstSubtotalColumn" => Some(Self::FirstSubtotalColumn),
            "secondSubtotalColumn" => Some(Self::SecondSubtotalColumn),
            "thirdSubtotalColumn" => Some(Self::ThirdSubtotalColumn),
            "firstSubtotalRow" => Some(Self::FirstSubtotalRow),
            "secondSubtotalRow" => Some(Self::SecondSubtotalRow),
            "thirdSubtotalRow" => Some(Self::ThirdSubtotalRow),
            "blankRow" => Some(Self::BlankRow),
            "firstColumnSubheading" => Some(Self::FirstColumnSubheading),
            "secondColumnSubheading" => Some(Self::SecondColumnSubheading),
            "thirdColumnSubheading" => Some(Self::ThirdColumnSubheading),
            "firstRowSubheading" => Some(Self::FirstRowSubheading),
            "secondRowSubheading" => Some(Self::SecondRowSubheading),
            "thirdRowSubheading" => Some(Self::ThirdRowSubheading),
            "pageFieldLabels" => Some(Self::PageFieldLabels),
            "pageFieldValues" => Some(Self::PageFieldValues),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::WholeTable => "wholeTable",
            Self::HeaderRow => "headerRow",
            Self::TotalRow => "totalRow",
            Self::FirstColumn => "firstColumn",
            Self::LastColumn => "lastColumn",
            Self::FirstRowStripe => "firstRowStripe",
            Self::SecondRowStripe => "secondRowStripe",
            Self::FirstColumnStripe => "firstColumnStripe",
            Self::SecondColumnStripe => "secondColumnStripe",
            Self::FirstHeaderCell => "firstHeaderCell",
            Self::LastHeaderCell => "lastHeaderCell",
            Self::FirstTotalCell => "firstTotalCell",
            Self::LastTotalCell => "lastTotalCell",
            Self::FirstSubtotalColumn => "firstSubtotalColumn",
            Self::SecondSubtotalColumn => "secondSubtotalColumn",
            Self::ThirdSubtotalColumn => "thirdSubtotalColumn",
            Self::FirstSubtotalRow => "firstSubtotalRow",
            Self::SecondSubtotalRow => "secondSubtotalRow",
            Self::ThirdSubtotalRow => "thirdSubtotalRow",
            Self::BlankRow => "blankRow",
            Self::FirstColumnSubheading => "firstColumnSubheading",
            Self::SecondColumnSubheading => "secondColumnSubheading",
            Self::ThirdColumnSubheading => "thirdColumnSubheading",
            Self::FirstRowSubheading => "firstRowSubheading",
            Self::SecondRowSubheading => "secondRowSubheading",
            Self::ThirdRowSubheading => "thirdRowSubheading",
            Self::PageFieldLabels => "pageFieldLabels",
            Self::PageFieldValues => "pageFieldValues",
        }
    }
}
// =============================================================================
// TableStyleElementDef
// =============================================================================

/// One element of a table style — maps a table region to a DXF index
/// (ECMA-376 CT_TableStyleElement).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableStyleElementDef {
    /// Which part of the table this format applies to.
    pub style_type: TableStyleType,
    /// Index into the stylesheet's dxfs array.
    pub dxf_id: Option<u32>,
    /// Number of rows/columns in a stripe (for stripe types, default 1).
    pub size: Option<u32>,
}

// =============================================================================
// TableStyleDef
// =============================================================================

/// A named table style definition (ECMA-376 CT_TableStyle).
///
/// Defines a complete table style (e.g., "TableStyleMedium2") as a
/// collection of DXF-based format assignments for different table regions.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct TableStyleDef {
    /// Style name (e.g., "TableStyleMedium2").
    pub name: String,
    /// Whether this is a pivot table style. `None` = absent (default true per XSD), `Some(bool)` = explicitly set.
    pub pivot: Option<bool>,
    /// Whether this style applies to regular tables. `None` = absent (default true per XSD), `Some(bool)` = explicitly set.
    pub table: Option<bool>,
    /// Number of table style elements.
    pub count: Option<u32>,
    /// Format elements — each maps a table region to a DXF.
    pub elements: Vec<TableStyleElementDef>,
    /// xr9:uid attribute (extension UID for versioning).
    pub xr_uid: Option<String>,
}
