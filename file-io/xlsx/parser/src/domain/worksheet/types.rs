//! Worksheet domain types owned by the XLSX parser.
//!
//! Most worksheet vocabulary structs live in `ooxml_types::worksheet`; this
//! module contains parser-local DTOs that do not belong in the shared OOXML
//! vocabulary crate.

/// Parsed sheet format properties from `<sheetFormatPr>`.
pub struct SheetFormatPrParsed {
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    pub base_col_width: Option<u32>,
    /// `x14ac:dyDescent` — default text baseline descent in points.
    pub default_row_descent: Option<f64>,
    /// Outline level for rows (outlineLevelRow attribute).
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol attribute).
    pub outline_level_col: Option<u8>,
    /// Whether the default row height is custom (customHeight="1").
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight="1").
    pub zero_height: bool,
    /// Whether default rows use thick top borders.
    pub thick_top: bool,
    /// Whether default rows use thick bottom borders.
    pub thick_bottom: bool,
}
