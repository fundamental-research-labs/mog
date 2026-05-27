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
// Vertical Align Run (re-exported from shared module)
// =============================================================================

pub use crate::shared::VerticalAlignRun;

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

/// Default indexed colour palette (66 entries, AARRGGBB without '#').
/// Canonical source: `domain-types/src/style_resolver.rs`.
const INDEXED_COLORS: [&str; 66] = [
    "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", // 0-7
    "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", // 8-15
    "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", // 16-23
    "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF", // 24-31
    "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF", // 32-39
    "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", // 40-47
    "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696", // 48-55
    "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333", // 56-63
    "000000", "FFFFFF", // 64=system foreground, 65=system background
];

// =============================================================================
// Color Definition
// =============================================================================

/// Color reference (ECMA-376 CT_Color).
///
/// Represents the four mutually-exclusive ways Excel specifies a colour.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ColorDef {
    /// Theme colour with index and optional tint (-1.0 to 1.0).
    Theme {
        /// Theme colour index (0-based).
        id: u32,
        /// Optional tint modifier (stored as original string for roundtrip fidelity).
        tint: Option<String>,
    },
    /// Direct RGB colour in AARRGGBB hex format (e.g., "FF000000" for opaque black).
    Rgb {
        /// Hex colour value.
        val: String,
        /// Optional tint modifier (stored as original string for roundtrip fidelity).
        tint: Option<String>,
    },
    /// Legacy indexed palette colour.
    Indexed {
        /// Palette index.
        id: u32,
        /// Optional tint modifier (stored as original string for roundtrip fidelity).
        tint: Option<String>,
    },
    /// Automatic colour (system default).
    Auto {
        /// Optional tint modifier (stored as original string for roundtrip fidelity).
        tint: Option<String>,
    },
}

impl ColorDef {
    /// Create a theme colour without tint.
    pub fn theme(id: u32) -> Self {
        Self::Theme { id, tint: None }
    }

    /// Create a theme colour with tint.
    pub fn theme_with_tint(id: u32, tint: impl Into<String>) -> Self {
        Self::Theme {
            id,
            tint: Some(tint.into()),
        }
    }

    /// Create an RGB colour from an AARRGGBB hex string.
    pub fn rgb(hex: impl Into<String>) -> Self {
        Self::Rgb {
            val: hex.into(),
            tint: None,
        }
    }

    /// Create an RGB colour with tint.
    pub fn rgb_with_tint(hex: impl Into<String>, tint: impl Into<String>) -> Self {
        Self::Rgb {
            val: hex.into(),
            tint: Some(tint.into()),
        }
    }

    /// Create an indexed palette colour.
    pub fn indexed(idx: u32) -> Self {
        Self::Indexed {
            id: idx,
            tint: None,
        }
    }

    /// Create an indexed palette colour with tint.
    pub fn indexed_with_tint(idx: u32, tint: impl Into<String>) -> Self {
        Self::Indexed {
            id: idx,
            tint: Some(tint.into()),
        }
    }

    /// Create an automatic colour.
    pub fn auto() -> Self {
        Self::Auto { tint: None }
    }

    /// Extract tint from any variant.
    pub fn tint(&self) -> Option<&str> {
        match self {
            ColorDef::Theme { tint, .. }
            | ColorDef::Rgb { tint, .. }
            | ColorDef::Indexed { tint, .. }
            | ColorDef::Auto { tint } => tint.as_deref(),
        }
    }

    /// Resolve to canonical ARGB hex (e.g. "FF000000").
    /// Returns `None` for `Theme` (requires theme context to resolve).
    pub fn to_argb(&self) -> Option<String> {
        match self {
            ColorDef::Rgb { val, .. } => Some(val.to_uppercase()),
            ColorDef::Indexed { id, .. } => INDEXED_COLORS
                .get(*id as usize)
                .map(|rgb| format!("FF{rgb}")),
            ColorDef::Auto { .. } => Some("FF000000".to_string()),
            ColorDef::Theme { .. } => None,
        }
    }

    /// Semantic equality: two `ColorDef`s are semantically equal if they resolve
    /// to the same visible colour. Falls back to structural equality when canonical
    /// ARGB cannot be determined (Theme colours).
    pub fn semantically_eq(&self, other: &ColorDef) -> bool {
        if self == other {
            return true;
        }
        match (self.to_argb(), other.to_argb()) {
            (Some(a), Some(b)) => a == b && tints_eq(self.tint(), other.tint()),
            _ => false,
        }
    }
}

/// Compare tint values semantically: `None` and `Some("0")` / `Some("0.0")` are equivalent.
fn tints_eq(a: Option<&str>, b: Option<&str>) -> bool {
    let parse = |t: Option<&str>| -> f64 { t.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0) };
    (parse(a) - parse(b)).abs() < 1e-9
}

/// Compare `Option<ColorDef>` values semantically.
fn colors_eq(a: &Option<ColorDef>, b: &Option<ColorDef>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a.semantically_eq(b),
        (None, None) => true,
        _ => false,
    }
}

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
// Font Definition
// =============================================================================

/// Font definition (ECMA-376 CT_Font).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FontDef {
    /// Font name (e.g., "Calibri", "Arial"). Optional per XSD (all CT_Font children are optional).
    pub name: Option<String>,
    /// Font size in points. Optional per XSD (DXF fonts may omit size).
    pub size: Option<f64>,
    /// Bold. `None` = element absent, `Some(false)` = `<b val="0"/>`, `Some(true)` = `<b/>`.
    pub bold: Option<bool>,
    /// Italic. `None` = element absent, `Some(false)` = `<i val="0"/>`, `Some(true)` = `<i/>`.
    pub italic: Option<bool>,
    /// Underline style.
    pub underline: Option<UnderlineStyle>,
    /// Strikethrough. `None` = element absent, `Some(false)` = `<strike val="0"/>`, `Some(true)` = `<strike/>`.
    pub strikethrough: Option<bool>,
    /// Font colour.
    pub color: Option<ColorDef>,
    /// Font family (1=Roman, 2=Swiss, 3=Modern, 4=Script, 5=Decorative).
    pub family: Option<u32>,
    /// Character set.
    pub charset: Option<u32>,
    /// Theme scheme.
    pub scheme: Option<FontScheme>,
    /// Condense (East Asian). `None` = absent, `Some(false)` = `<condense val="0"/>`, `Some(true)` = `<condense/>`.
    pub condense: Option<bool>,
    /// Extend (East Asian). `None` = absent, `Some(false)` = `<extend val="0"/>`, `Some(true)` = `<extend/>`.
    pub extend: Option<bool>,
    /// Vertical alignment for text runs (superscript/subscript).
    pub vert_align: Option<VerticalAlignRun>,
    /// Outline font effect. `None` = absent, `Some(false)` = `<outline val="0"/>`, `Some(true)` = `<outline/>`.
    pub outline: Option<bool>,
    /// Shadow font effect. `None` = absent, `Some(false)` = `<shadow val="0"/>`, `Some(true)` = `<shadow/>`.
    pub shadow: Option<bool>,
}

impl FontDef {
    /// Semantic equality: all fields use structural `==` except `color` which
    /// uses `ColorDef::semantically_eq`.
    pub fn semantically_eq(&self, other: &FontDef) -> bool {
        self.name == other.name
            && self.size == other.size
            && self.bold == other.bold
            && self.italic == other.italic
            && self.underline == other.underline
            && self.strikethrough == other.strikethrough
            && colors_eq(&self.color, &other.color)
            && self.family == other.family
            && self.charset == other.charset
            && self.scheme == other.scheme
            && self.condense == other.condense
            && self.extend == other.extend
            && self.vert_align == other.vert_align
            && self.outline == other.outline
            && self.shadow == other.shadow
    }
}

// =============================================================================
// Gradient Stop
// =============================================================================

/// A colour stop in a gradient fill (ECMA-376 CT_GradientStop).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GradientStop {
    /// Position within the gradient (0.0 to 1.0).
    pub position: f64,
    /// Colour at this position.
    pub color: ColorDef,
}

// =============================================================================
// Fill Definition
// =============================================================================

/// Fill definition (ECMA-376 CT_Fill).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub enum FillDef {
    /// No fill (patternType="none" with no colours).
    #[default]
    None,
    /// Solid fill with a single foreground colour.
    Solid {
        /// Foreground colour.
        fg_color: ColorDef,
    },
    /// Pattern fill.
    Pattern {
        /// Pattern type. `None` means the attribute was absent in the original XML
        /// (OOXML default is "none"). `Some(PatternType::None)` means `patternType="none"`
        /// was explicitly present.
        pattern_type: Option<PatternType>,
        /// Foreground colour.
        fg_color: Option<ColorDef>,
        /// Background colour.
        bg_color: Option<ColorDef>,
    },
    /// Gradient fill.
    Gradient {
        /// Gradient type (linear or path).
        gradient_type: GradientType,
        /// Gradient angle in degrees (for linear gradients).
        degree: Option<f64>,
        /// Colour stops.
        stops: Vec<GradientStop>,
        /// Fill-to rectangle for path gradients (percentages 0.0-1.0).
        left: Option<f64>,
        right: Option<f64>,
        top: Option<f64>,
        bottom: Option<f64>,
    },
}

impl FillDef {
    /// Semantic equality: variant-matched comparison where colour fields use
    /// `ColorDef::semantically_eq` and gradient stops compare colours semantically.
    pub fn semantically_eq(&self, other: &FillDef) -> bool {
        match (self, other) {
            (FillDef::None, FillDef::None) => true,
            (FillDef::Solid { fg_color: a }, FillDef::Solid { fg_color: b }) => {
                a.semantically_eq(b)
            }
            (
                FillDef::Pattern {
                    pattern_type: pt_a,
                    fg_color: fg_a,
                    bg_color: bg_a,
                },
                FillDef::Pattern {
                    pattern_type: pt_b,
                    fg_color: fg_b,
                    bg_color: bg_b,
                },
            ) => pt_a == pt_b && colors_eq(fg_a, fg_b) && colors_eq(bg_a, bg_b),
            (
                FillDef::Gradient {
                    gradient_type: gt_a,
                    degree: deg_a,
                    stops: stops_a,
                    left: l_a,
                    right: r_a,
                    top: t_a,
                    bottom: b_a,
                },
                FillDef::Gradient {
                    gradient_type: gt_b,
                    degree: deg_b,
                    stops: stops_b,
                    left: l_b,
                    right: r_b,
                    top: t_b,
                    bottom: b_b,
                },
            ) => {
                gt_a == gt_b
                    && deg_a == deg_b
                    && l_a == l_b
                    && r_a == r_b
                    && t_a == t_b
                    && b_a == b_b
                    && stops_a.len() == stops_b.len()
                    && stops_a
                        .iter()
                        .zip(stops_b.iter())
                        .all(|(a, b)| a.position == b.position && a.color.semantically_eq(&b.color))
            }
            _ => false,
        }
    }
}

// =============================================================================
// Border Side Definition
// =============================================================================

/// One side of a border (ECMA-376 CT_BorderPr).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BorderSideDef {
    /// Border style.
    pub style: BorderStyle,
    /// Border colour.
    pub color: Option<ColorDef>,
}

impl Default for BorderSideDef {
    fn default() -> Self {
        Self {
            style: BorderStyle::None,
            color: None,
        }
    }
}

// =============================================================================
// Border Definition
// =============================================================================

/// Border definition (ECMA-376 CT_Border).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct BorderDef {
    /// Left border.
    pub left: Option<BorderSideDef>,
    /// Right border.
    pub right: Option<BorderSideDef>,
    /// Top border.
    pub top: Option<BorderSideDef>,
    /// Bottom border.
    pub bottom: Option<BorderSideDef>,
    /// Diagonal border.
    pub diagonal: Option<BorderSideDef>,
    /// Diagonal up (bottom-left to top-right). `None` = absent (default false), `Some(bool)` = explicitly set.
    pub diagonal_up: Option<bool>,
    /// Diagonal down (top-left to bottom-right). `None` = absent (default false), `Some(bool)` = explicitly set.
    pub diagonal_down: Option<bool>,
    /// Start border (BiDi replacement for left).
    pub start: Option<BorderSideDef>,
    /// End border (BiDi replacement for right).
    pub end: Option<BorderSideDef>,
    /// Vertical interior border (table styles).
    pub vertical: Option<BorderSideDef>,
    /// Horizontal interior border (table styles).
    pub horizontal: Option<BorderSideDef>,
    /// Whether to draw outline borders (default true). `None` = absent (default true), `Some(bool)` = explicitly set.
    pub outline: Option<bool>,
}

impl BorderSideDef {
    /// Returns `true` if this side has no visible border (style=None, no color).
    pub fn is_empty(&self) -> bool {
        self.style == BorderStyle::None && self.color.is_none()
    }

    /// Semantic equality: compares style structurally and colour semantically.
    pub fn semantically_eq(&self, other: &BorderSideDef) -> bool {
        self.style == other.style && colors_eq(&self.color, &other.color)
    }
}

impl BorderDef {
    /// Normalize an `Option<BorderSideDef>`: collapse `Some(empty)` → `None`.
    fn normalize_side(side: &Option<BorderSideDef>) -> Option<&BorderSideDef> {
        side.as_ref().filter(|s| !s.is_empty())
    }

    /// Semantic equality: treats `Some(BorderSideDef { style: None, color: None })`
    /// the same as `None` for each border side, and compares colours semantically
    /// (e.g. `Indexed(64)` == `Rgb("FF000000")`).
    pub fn semantically_eq(&self, other: &BorderDef) -> bool {
        fn sides_eq(a: Option<&BorderSideDef>, b: Option<&BorderSideDef>) -> bool {
            match (a, b) {
                (Some(a), Some(b)) => a.semantically_eq(b),
                (None, None) => true,
                _ => false,
            }
        }
        sides_eq(
            Self::normalize_side(&self.left),
            Self::normalize_side(&other.left),
        ) && sides_eq(
            Self::normalize_side(&self.right),
            Self::normalize_side(&other.right),
        ) && sides_eq(
            Self::normalize_side(&self.top),
            Self::normalize_side(&other.top),
        ) && sides_eq(
            Self::normalize_side(&self.bottom),
            Self::normalize_side(&other.bottom),
        ) && sides_eq(
            Self::normalize_side(&self.diagonal),
            Self::normalize_side(&other.diagonal),
        ) && self.diagonal_up == other.diagonal_up
            && self.diagonal_down == other.diagonal_down
            && sides_eq(
                Self::normalize_side(&self.start),
                Self::normalize_side(&other.start),
            )
            && sides_eq(
                Self::normalize_side(&self.end),
                Self::normalize_side(&other.end),
            )
            && sides_eq(
                Self::normalize_side(&self.vertical),
                Self::normalize_side(&other.vertical),
            )
            && sides_eq(
                Self::normalize_side(&self.horizontal),
                Self::normalize_side(&other.horizontal),
            )
            && self.outline == other.outline
    }
}

// =============================================================================
// Alignment Definition
// =============================================================================

/// Cell alignment definition (ECMA-376 CT_CellAlignment).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlignmentDef {
    /// Horizontal alignment.
    pub horizontal: Option<HorizontalAlign>,
    /// Vertical alignment.
    pub vertical: Option<VerticalAlign>,
    /// Wrap text. `None` = not specified (distinct from `Some(false)` for style inheritance).
    pub wrap_text: Option<bool>,
    /// Text rotation (0-180, or 255 for vertical text).
    pub text_rotation: Option<u32>,
    /// Indent level.
    pub indent: Option<u32>,
    /// Shrink to fit. `None` = not specified (distinct from `Some(false)` for style inheritance).
    pub shrink_to_fit: Option<bool>,
    /// Reading order (0=context, 1=left-to-right, 2=right-to-left).
    pub reading_order: Option<u32>,
    /// Relative indent adjustment (CT_CellAlignment.relativeIndent, xsd:int).
    pub relative_indent: Option<i32>,
    /// Whether to justify the last line of text (CT_CellAlignment.justifyLastLine).
    pub justify_last_line: Option<bool>,
    /// Auto-indent flag (CT_CellAlignment.autoIndent).
    pub auto_indent: Option<bool>,
}

// =============================================================================
// Protection Definition
// =============================================================================

/// Cell protection definition (ECMA-376 CT_CellProtection).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct ProtectionDef {
    /// Cell is locked. `None` = not specified (Excel defaults to locked when sheet is protected).
    pub locked: Option<bool>,
    /// Formula is hidden. `None` = not specified.
    pub hidden: Option<bool>,
}

// =============================================================================
// Cell XF Definition
// =============================================================================

/// Cell XF (eXtended Format) — a combination of style component indices plus
/// inline alignment and protection overrides (ECMA-376 CT_Xf).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CellXfDef {
    /// Number format ID (references numFmts or built-in). Optional per XSD.
    pub num_fmt_id: Option<u32>,
    /// Font ID (index into fonts array). Optional per XSD.
    pub font_id: Option<u32>,
    /// Fill ID (index into fills array). Optional per XSD.
    pub fill_id: Option<u32>,
    /// Border ID (index into borders array). Optional per XSD.
    pub border_id: Option<u32>,
    /// Reference to cellStyleXf (parent style).
    pub xf_id: Option<u32>,
    /// Cell alignment.
    pub alignment: Option<AlignmentDef>,
    /// Cell protection.
    pub protection: Option<ProtectionDef>,
    /// Apply number format from this xf. `None` = not specified (distinct from `Some(false)`).
    pub apply_number_format: Option<bool>,
    /// Apply font from this xf. `None` = not specified.
    pub apply_font: Option<bool>,
    /// Apply fill from this xf. `None` = not specified.
    pub apply_fill: Option<bool>,
    /// Apply border from this xf. `None` = not specified.
    pub apply_border: Option<bool>,
    /// Apply alignment from this xf. `None` = not specified.
    pub apply_alignment: Option<bool>,
    /// Apply protection from this xf. `None` = not specified.
    pub apply_protection: Option<bool>,
    /// Quote prefix — display leading apostrophe.
    pub quote_prefix: bool,
    /// Pivot button — cell contains pivot table dropdown.
    pub pivot_button: bool,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}

// =============================================================================
// CellStyleDef
// =============================================================================

/// Named cell style (ECMA-376 CT_CellStyle).
///
/// Defines a named style like "Normal", "Percent", "Heading 1", etc.
/// Each named style references a cellStyleXf by index.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CellStyleDef {
    /// Display name (e.g., "Normal", "Percent"). XSD optional.
    pub name: Option<String>,
    /// Index into cellStyleXfs array.
    pub xf_id: u32,
    /// Built-in style ID (0 = Normal, 3 = Comma, 4 = Currency, etc.).
    pub builtin_id: Option<u32>,
    /// Custom style flag (XSD optional, default false).
    pub custom_builtin: Option<bool>,
    /// Outline level for built-in styles (CT_CellStyle.iLevel).
    pub i_level: Option<u32>,
    /// Whether the style is hidden from the UI (CT_CellStyle.hidden).
    pub hidden: Option<bool>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
    /// Revision UID (xr:uid attribute) for co-authoring / revision tracking.
    pub xr_uid: Option<String>,
}

impl CellStyleDef {
    /// Effective display name (returns empty string when absent).
    #[must_use]
    pub fn effective_name(&self) -> &str {
        self.name.as_deref().unwrap_or("")
    }

    /// Effective custom_builtin flag (defaults to `false` when absent per XSD).
    #[must_use]
    pub fn effective_custom_builtin(&self) -> bool {
        self.custom_builtin.unwrap_or(false)
    }
}

// =============================================================================
// DxfDef
// =============================================================================

/// Differential formatting record (ECMA-376 CT_Dxf).
///
/// Used by conditional formatting rules and table styles to specify
/// partial formatting overrides (only the fields that differ from the base).
/// Every field is optional — only set fields are applied.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DxfDef {
    /// Font overrides.
    pub font: Option<FontDef>,
    /// Number format override.
    pub num_fmt: Option<NumberFormatDef>,
    /// Fill override.
    pub fill: Option<FillDef>,
    /// Border override.
    pub border: Option<BorderDef>,
    /// Alignment override.
    pub alignment: Option<AlignmentDef>,
    /// Protection override.
    pub protection: Option<ProtectionDef>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}

// =============================================================================
// ColorsDef
// =============================================================================

/// Custom color palette (ECMA-376 CT_Colors).
///
/// Contains overrides for the default indexed color palette and
/// a most-recently-used (MRU) color list for the color picker UI.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorsDef {
    /// Custom indexed color palette overrides.
    /// When present, these replace the default 64-color indexed palette
    /// at the corresponding indices. The list is ordered by index (0, 1, 2, …).
    pub indexed_colors: Vec<String>,
    /// Most-recently-used colors from the color picker.
    /// Supports theme, indexed, RGB, and auto colors per ECMA-376 CT_MRUColors.
    pub mru_colors: Vec<ColorDef>,
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

// =============================================================================
// Stylesheet
// =============================================================================

/// Root stylesheet container (ECMA-376 CT_Stylesheet).
///
/// This is the top-level type corresponding to `xl/styles.xml`.
/// The parser produces this, the writer consumes it.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Stylesheet {
    /// Custom number formats (IDs >= 164).
    pub num_fmts: Vec<NumberFormatDef>,
    /// Font definitions.
    pub fonts: Vec<FontDef>,
    /// Whether `x14ac:knownFonts="1"` was present on the `<fonts>` element.
    /// Indicates the producing application verified all referenced fonts are
    /// available on the system.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub known_fonts: bool,
    /// Fill definitions.
    pub fills: Vec<FillDef>,
    /// Border definitions.
    pub borders: Vec<BorderDef>,
    /// Cell style XFs (base styles referenced by named styles).
    pub cell_style_xfs: Vec<CellXfDef>,
    /// Cell XFs (the style index in cell `s` attribute references this).
    pub cell_xfs: Vec<CellXfDef>,
    /// Named cell styles.
    pub cell_styles: Vec<CellStyleDef>,
    /// Differential formatting records (for CF and tables).
    pub dxfs: Vec<DxfDef>,
    /// Custom color palette and MRU colors.
    pub colors: Option<ColorsDef>,
    /// Table style definitions.
    pub table_styles: Vec<TableStyleDef>,
    /// Default table style name.
    pub default_table_style: Option<String>,
    /// Default pivot table style name.
    pub default_pivot_style: Option<String>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}

// =============================================================================
// RgbColor
// =============================================================================

/// An RGB color value (ECMA-376 CT_RgbColor).
///
/// Represents a single RGB colour entry as a hex string (e.g., "FF0000FF").
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct RgbColor {
    /// RGB colour value as an 8-character hex string (AARRGGBB).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgb: Option<String>,
}

// =============================================================================
// IndexedColors
// =============================================================================

/// Custom indexed color palette (ECMA-376 CT_IndexedColors).
///
/// When present, the RGB values in this list replace the default 64-colour
/// indexed palette at the corresponding indices.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct IndexedColors {
    /// Ordered list of RGB colour entries (one per index).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rgb_color: Vec<RgbColor>,
}

// =============================================================================
// MruColors
// =============================================================================

/// Most-recently-used colour list (ECMA-376 CT_MRUColors).
///
/// Stores the colours most recently chosen in the colour-picker UI.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct MruColors {
    /// Most recently used colours.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub color: Vec<ColorDef>,
}

// =============================================================================
// NumFmts
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

// =============================================================================
// Tests
// =============================================================================
