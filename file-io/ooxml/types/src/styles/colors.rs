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
pub(super) fn colors_eq(a: &Option<ColorDef>, b: &Option<ColorDef>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a.semantically_eq(b),
        (None, None) => true,
        _ => false,
    }
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
