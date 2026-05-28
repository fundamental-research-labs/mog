use crate::drawings::DrawingColor;

// =============================================================================
// Custom Color (CT_CustomColor)
// =============================================================================

/// A user-defined custom color (ECMA-376 CT_CustomColor).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomColor {
    /// Optional display name
    pub name: Option<String>,
    /// The color value
    pub color: DrawingColor,
}

// =============================================================================
// Custom Color List (CT_CustomColorList)
// =============================================================================

/// List of custom colors (ECMA-376 CT_CustomColorList).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CustomColorList {
    /// Custom color entries
    pub cust_clr: Vec<CustomColor>,
}
