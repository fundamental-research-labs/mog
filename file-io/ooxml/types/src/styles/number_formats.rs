// =============================================================================
// Number Format Definition
// =============================================================================

/// Number format definition (ECMA-376 CT_NumFmt).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct NumberFormatDef {
    /// Format ID (custom formats start at 164).
    pub id: u32,
    /// The format code string (e.g., "#,##0.00", "yyyy-mm-dd").
    pub format_code: String,
}
// =============================================================================

/// Number format collection (ECMA-376 CT_NumFmts).
///
/// Container for custom number format definitions in the stylesheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct NumFmts {
    /// Number of format entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
    /// Number format definitions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub num_fmt: Vec<NumberFormatDef>,
}
