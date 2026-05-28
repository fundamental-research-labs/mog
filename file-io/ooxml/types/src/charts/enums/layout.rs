// =============================================================================
// LayoutTarget
// =============================================================================

/// Layout target (ST_LayoutTarget).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum LayoutTarget {
    /// Inner plot area
    Inner,
    /// Outer chart area (default per ST_LayoutTarget)
    #[default]
    Outer,
}

impl LayoutTarget {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "inner" => Self::Inner,
            "outer" => Self::Outer,
            _ => Self::Outer,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Inner => "inner",
            Self::Outer => "outer",
        }
    }
}

// =============================================================================
// LayoutMode
// =============================================================================

/// Layout mode (ST_LayoutMode).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum LayoutMode {
    /// Relative to edge
    Edge,
    /// Factor of chart dimension (default per ST_LayoutMode)
    #[default]
    Factor,
}

impl LayoutMode {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "edge" => Self::Edge,
            "factor" => Self::Factor,
            _ => Self::Factor,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Edge => "edge",
            Self::Factor => "factor",
        }
    }
}

// =============================================================================
// AnchorType
// =============================================================================

/// Drawing anchor type for chart placement.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum AnchorType {
    /// Two-cell anchor -- moves and resizes with cells (default)
    #[default]
    TwoCell,
    /// One-cell anchor -- moves with cell, fixed size
    OneCell,
    /// Absolute position -- fixed position and size
    Absolute,
}

impl AnchorType {
    /// Parse from an OOXML element name.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "twoCellAnchor" => Self::TwoCell,
            "oneCellAnchor" => Self::OneCell,
            "absoluteAnchor" => Self::Absolute,
            _ => Self::TwoCell,
        }
    }

    /// Serialize to the OOXML element name.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::TwoCell => "twoCellAnchor",
            Self::OneCell => "oneCellAnchor",
            Self::Absolute => "absoluteAnchor",
        }
    }
}
