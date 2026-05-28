// =============================================================================
// Underline Style
// =============================================================================

/// Font underline style (ECMA-376 ST_UnderlineValues).
///
/// Serde variant renames use OOXML-token form (lowercase / lowerCamelCase) so
/// this enum can replace `Option<String>` fields that previously held OOXML
/// tokens like `"single"` or `"doubleAccounting"` byte-for-byte on the wire.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum UnderlineStyle {
    /// No underline
    #[serde(rename = "none")]
    #[default]
    None,
    /// Single underline (default when `<u/>` appears without a `val` attribute)
    #[serde(rename = "single")]
    Single,
    /// Double underline
    #[serde(rename = "double")]
    Double,
    /// Single accounting underline (extends to column width)
    #[serde(rename = "singleAccounting")]
    SingleAccounting,
    /// Double accounting underline
    #[serde(rename = "doubleAccounting")]
    DoubleAccounting,
}

impl UnderlineStyle {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly. A bare `<u/>` tag (no `val`
    /// attribute) is Excel's way of saying "single underline"; that is a
    /// *parse-path* concern — handled by the XLSX reader passing `"single"`
    /// as the default when the attribute is absent, not by this function
    /// silently defaulting on unrecognized input.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "none" => Self::None,
            "single" => Self::Single,
            "double" => Self::Double,
            "singleAccounting" => Self::SingleAccounting,
            "doubleAccounting" => Self::DoubleAccounting,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Single => "single",
            Self::Double => "double",
            Self::SingleAccounting => "singleAccounting",
            Self::DoubleAccounting => "doubleAccounting",
        }
    }
}

// =============================================================================
// Pattern Type
// =============================================================================

/// Pattern fill type (ECMA-376 ST_PatternType).
///
/// Serde variant renames use OOXML tokens so this enum can replace
/// `Option<String>` fields that held OOXML pattern tokens like `"solid"`.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum PatternType {
    /// No pattern
    #[default]
    #[serde(rename = "none")]
    None,
    /// Solid fill
    #[serde(rename = "solid")]
    Solid,
    /// Medium gray (50%)
    #[serde(rename = "mediumGray")]
    MediumGray,
    /// Dark gray (75%)
    #[serde(rename = "darkGray")]
    DarkGray,
    /// Light gray (25%)
    #[serde(rename = "lightGray")]
    LightGray,
    /// Dark horizontal lines
    #[serde(rename = "darkHorizontal")]
    DarkHorizontal,
    /// Dark vertical lines
    #[serde(rename = "darkVertical")]
    DarkVertical,
    /// Dark down diagonal
    #[serde(rename = "darkDown")]
    DarkDown,
    /// Dark up diagonal
    #[serde(rename = "darkUp")]
    DarkUp,
    /// Dark grid (horizontal + vertical)
    #[serde(rename = "darkGrid")]
    DarkGrid,
    /// Dark trellis (diagonal crosshatch)
    #[serde(rename = "darkTrellis")]
    DarkTrellis,
    /// Light horizontal lines
    #[serde(rename = "lightHorizontal")]
    LightHorizontal,
    /// Light vertical lines
    #[serde(rename = "lightVertical")]
    LightVertical,
    /// Light down diagonal
    #[serde(rename = "lightDown")]
    LightDown,
    /// Light up diagonal
    #[serde(rename = "lightUp")]
    LightUp,
    /// Light grid
    #[serde(rename = "lightGrid")]
    LightGrid,
    /// Light trellis
    #[serde(rename = "lightTrellis")]
    LightTrellis,
    /// 12.5% gray
    #[serde(rename = "gray125")]
    Gray125,
    /// 6.25% gray
    #[serde(rename = "gray0625")]
    Gray0625,
}

impl PatternType {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "none" => Self::None,
            "solid" => Self::Solid,
            "mediumGray" => Self::MediumGray,
            "darkGray" => Self::DarkGray,
            "lightGray" => Self::LightGray,
            "darkHorizontal" => Self::DarkHorizontal,
            "darkVertical" => Self::DarkVertical,
            "darkDown" => Self::DarkDown,
            "darkUp" => Self::DarkUp,
            "darkGrid" => Self::DarkGrid,
            "darkTrellis" => Self::DarkTrellis,
            "lightHorizontal" => Self::LightHorizontal,
            "lightVertical" => Self::LightVertical,
            "lightDown" => Self::LightDown,
            "lightUp" => Self::LightUp,
            "lightGrid" => Self::LightGrid,
            "lightTrellis" => Self::LightTrellis,
            "gray125" => Self::Gray125,
            "gray0625" => Self::Gray0625,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Solid => "solid",
            Self::MediumGray => "mediumGray",
            Self::DarkGray => "darkGray",
            Self::LightGray => "lightGray",
            Self::DarkHorizontal => "darkHorizontal",
            Self::DarkVertical => "darkVertical",
            Self::DarkDown => "darkDown",
            Self::DarkUp => "darkUp",
            Self::DarkGrid => "darkGrid",
            Self::DarkTrellis => "darkTrellis",
            Self::LightHorizontal => "lightHorizontal",
            Self::LightVertical => "lightVertical",
            Self::LightDown => "lightDown",
            Self::LightUp => "lightUp",
            Self::LightGrid => "lightGrid",
            Self::LightTrellis => "lightTrellis",
            Self::Gray125 => "gray125",
            Self::Gray0625 => "gray0625",
        }
    }
}

// =============================================================================
// Gradient Type
// =============================================================================

/// Gradient fill type (ECMA-376 CT_GradientFill `type` attribute).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum GradientType {
    /// Linear gradient
    #[default]
    Linear,
    /// Path gradient (radial-like)
    Path,
}

impl GradientType {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "linear" => Self::Linear,
            "path" => Self::Path,
            _ => Self::Linear,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Linear => "linear",
            Self::Path => "path",
        }
    }
}

// =============================================================================
// Border Style
// =============================================================================

/// Border line style (ECMA-376 ST_BorderStyle).
///
/// Serde variant renames use OOXML tokens so this enum can replace
/// `Option<String>` fields that held OOXML border tokens like `"thin"`.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum BorderStyle {
    /// No border
    #[default]
    #[serde(rename = "none")]
    None,
    /// Thin border
    #[serde(rename = "thin")]
    Thin,
    /// Medium border
    #[serde(rename = "medium")]
    Medium,
    /// Dashed border
    #[serde(rename = "dashed")]
    Dashed,
    /// Dotted border
    #[serde(rename = "dotted")]
    Dotted,
    /// Thick border
    #[serde(rename = "thick")]
    Thick,
    /// Double border
    #[serde(rename = "double")]
    Double,
    /// Hair border (very thin)
    #[serde(rename = "hair")]
    Hair,
    /// Medium dashed border
    #[serde(rename = "mediumDashed")]
    MediumDashed,
    /// Dash-dot border
    #[serde(rename = "dashDot")]
    DashDot,
    /// Medium dash-dot border
    #[serde(rename = "mediumDashDot")]
    MediumDashDot,
    /// Dash-dot-dot border
    #[serde(rename = "dashDotDot")]
    DashDotDot,
    /// Medium dash-dot-dot border
    #[serde(rename = "mediumDashDotDot")]
    MediumDashDotDot,
    /// Slant dash-dot border
    #[serde(rename = "slantDashDot")]
    SlantDashDot,
}

impl BorderStyle {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "none" => Self::None,
            "thin" => Self::Thin,
            "medium" => Self::Medium,
            "dashed" => Self::Dashed,
            "dotted" => Self::Dotted,
            "thick" => Self::Thick,
            "double" => Self::Double,
            "hair" => Self::Hair,
            "mediumDashed" => Self::MediumDashed,
            "dashDot" => Self::DashDot,
            "mediumDashDot" => Self::MediumDashDot,
            "dashDotDot" => Self::DashDotDot,
            "mediumDashDotDot" => Self::MediumDashDotDot,
            "slantDashDot" => Self::SlantDashDot,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Thin => "thin",
            Self::Medium => "medium",
            Self::Dashed => "dashed",
            Self::Dotted => "dotted",
            Self::Thick => "thick",
            Self::Double => "double",
            Self::Hair => "hair",
            Self::MediumDashed => "mediumDashed",
            Self::DashDot => "dashDot",
            Self::MediumDashDot => "mediumDashDot",
            Self::DashDotDot => "dashDotDot",
            Self::MediumDashDotDot => "mediumDashDotDot",
            Self::SlantDashDot => "slantDashDot",
        }
    }
}

// =============================================================================
// Horizontal Alignment
// =============================================================================

/// Horizontal cell alignment (ECMA-376 ST_HorizontalAlignment).
///
/// Serde variant renames use OOXML tokens so this enum can replace
/// `Option<String>` fields that held OOXML alignment tokens like `"left"`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum HorizontalAlign {
    /// General alignment (text left, numbers right)
    #[serde(rename = "general")]
    #[default]
    General,
    /// Left alignment
    #[serde(rename = "left")]
    Left,
    /// Center alignment
    #[serde(rename = "center")]
    Center,
    /// Right alignment
    #[serde(rename = "right")]
    Right,
    /// Fill alignment (repeats content to fill cell width)
    #[serde(rename = "fill")]
    Fill,
    /// Justify alignment
    #[serde(rename = "justify")]
    Justify,
    /// Center continuous alignment (center across selection)
    #[serde(rename = "centerContinuous")]
    CenterContinuous,
    /// Distributed alignment (East Asian typography)
    #[serde(rename = "distributed")]
    Distributed,
}

impl HorizontalAlign {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "general" => Self::General,
            "left" => Self::Left,
            "center" => Self::Center,
            "right" => Self::Right,
            "fill" => Self::Fill,
            "justify" => Self::Justify,
            "centerContinuous" => Self::CenterContinuous,
            "distributed" => Self::Distributed,
            _ => return None,
        })
    }

    /// Byte-level parse for the XLSX streaming byte-parser. This is the
    /// external-format read path — Excel occasionally emits tokens newer
    /// than our vocabulary, so a lenient fallback keeps existing
    /// workbooks openable. For *internal* read paths (Yrs, palette,
    /// domain→CellFormat), use [`Self::from_ooxml_token`] which surfaces
    /// unknowns loudly.
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"general" => Self::General,
            b"left" => Self::Left,
            b"center" => Self::Center,
            b"right" => Self::Right,
            b"fill" => Self::Fill,
            b"justify" => Self::Justify,
            b"centerContinuous" => Self::CenterContinuous,
            b"distributed" => Self::Distributed,
            _ => Self::General,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::General => "general",
            Self::Left => "left",
            Self::Center => "center",
            Self::Right => "right",
            Self::Fill => "fill",
            Self::Justify => "justify",
            Self::CenterContinuous => "centerContinuous",
            Self::Distributed => "distributed",
        }
    }

    /// Alias for `to_ooxml` (used by XmlWrite derive).
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        self.to_ooxml()
    }
}

// =============================================================================
// Vertical Alignment
// =============================================================================

/// Vertical cell alignment (ECMA-376 ST_VerticalAlignment).
///
/// Serde variant renames use OOXML tokens so this enum can replace
/// `Option<String>` fields that held OOXML alignment tokens like `"top"`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum VerticalAlign {
    /// Top alignment
    #[serde(rename = "top")]
    Top,
    /// Center alignment
    #[serde(rename = "center")]
    Center,
    /// Bottom alignment
    #[serde(rename = "bottom")]
    #[default]
    Bottom,
    /// Justify alignment
    #[serde(rename = "justify")]
    Justify,
    /// Distributed alignment
    #[serde(rename = "distributed")]
    Distributed,
}

impl VerticalAlign {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "top" => Self::Top,
            "center" => Self::Center,
            "bottom" => Self::Bottom,
            "justify" => Self::Justify,
            "distributed" => Self::Distributed,
            _ => return None,
        })
    }

    /// Byte-level parse for the XLSX streaming byte-parser. Lenient
    /// fallback to `Bottom` (Excel's default) for the external-format
    /// read path. For internal paths, use [`Self::from_ooxml_token`].
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"top" => Self::Top,
            b"center" => Self::Center,
            b"bottom" => Self::Bottom,
            b"justify" => Self::Justify,
            b"distributed" => Self::Distributed,
            _ => Self::Bottom,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Center => "center",
            Self::Bottom => "bottom",
            Self::Justify => "justify",
            Self::Distributed => "distributed",
        }
    }

    /// Alias for `to_ooxml` (used by XmlWrite derive).
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        self.to_ooxml()
    }
}

// =============================================================================
// Font Scheme
// =============================================================================

/// Font scheme (ECMA-376 ST_FontScheme).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum FontScheme {
    /// No font scheme
    #[default]
    None,
    /// Major (heading) font
    Major,
    /// Minor (body) font
    Minor,
}

impl FontScheme {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "major" => Self::Major,
            "minor" => Self::Minor,
            _ => Self::None,
        }
    }

    /// Parse from raw XML attribute bytes (for the byte-level parser).
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"none" => Self::None,
            b"major" => Self::Major,
            b"minor" => Self::Minor,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Major => "major",
            Self::Minor => "minor",
        }
    }

    /// Alias for `to_ooxml` (used by XmlWrite derive).
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        self.to_ooxml()
    }
}
