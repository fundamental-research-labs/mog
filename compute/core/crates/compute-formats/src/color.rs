//! Excel color palette and format color types.
//!
//! Provides the [`FormatColor`] enum used by format codes to specify text color,
//! and the full 56-color Excel indexed palette.

/// Excel's 56-color indexed palette. Maps index 1-56 to hex color strings.
pub static EXCEL_COLOR_PALETTE: [(u8, &str); 56] = [
    (1, "#000000"),  // Black
    (2, "#FFFFFF"),  // White
    (3, "#FF0000"),  // Red
    (4, "#00FF00"),  // Bright Green
    (5, "#0000FF"),  // Blue
    (6, "#FFFF00"),  // Yellow
    (7, "#FF00FF"),  // Magenta
    (8, "#00FFFF"),  // Cyan
    (9, "#800000"),  // Dark Red
    (10, "#008000"), // Green
    (11, "#000080"), // Dark Blue
    (12, "#808000"), // Olive
    (13, "#800080"), // Purple
    (14, "#008080"), // Teal
    (15, "#C0C0C0"), // Silver
    (16, "#808080"), // Gray
    (17, "#9999FF"),
    (18, "#993366"),
    (19, "#FFFFCC"),
    (20, "#CCFFFF"),
    (21, "#660066"),
    (22, "#FF8080"),
    (23, "#0066CC"),
    (24, "#CCCCFF"),
    (25, "#000080"),
    (26, "#FF00FF"),
    (27, "#FFFF00"),
    (28, "#00FFFF"),
    (29, "#800080"),
    (30, "#800000"),
    (31, "#008080"),
    (32, "#0000FF"),
    (33, "#00CCFF"),
    (34, "#CCFFFF"),
    (35, "#CCFFCC"),
    (36, "#FFFF99"),
    (37, "#99CCFF"),
    (38, "#FF99CC"),
    (39, "#CC99FF"),
    (40, "#FFCC99"),
    (41, "#3366FF"),
    (42, "#33CCCC"),
    (43, "#99CC00"),
    (44, "#FFCC00"),
    (45, "#FF9900"),
    (46, "#FF6600"),
    (47, "#666699"),
    (48, "#969696"),
    (49, "#003366"),
    (50, "#339966"),
    (51, "#003300"),
    (52, "#333300"),
    (53, "#993300"),
    (54, "#993366"),
    (55, "#333399"),
    (56, "#333333"),
];

/// Look up a hex color string from the Excel palette by 1-based index.
///
/// Returns `None` if `index` is 0 or greater than 56.
///
/// # Examples
///
/// ```
/// use compute_formats::palette_color;
///
/// assert_eq!(palette_color(1), Some("#000000")); // Black
/// assert_eq!(palette_color(3), Some("#FF0000")); // Red
/// assert_eq!(palette_color(0), None);
/// assert_eq!(palette_color(57), None);
/// ```
#[must_use]
pub fn palette_color(index: u8) -> Option<&'static str> {
    if index == 0 || index > 56 {
        return None;
    }
    Some(EXCEL_COLOR_PALETTE[(index - 1) as usize].1)
}

/// A color directive from an Excel format code.
///
/// Format codes can include color directives like `[Red]`, `[Blue]`, or
/// indexed colors like `[Color3]` which maps to the Excel color palette.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum FormatColor {
    /// Black (`[Black]`).
    Black,
    /// Blue (`[Blue]`).
    Blue,
    /// Cyan (`[Cyan]`).
    Cyan,
    /// Green (`[Green]`).
    Green,
    /// Magenta (`[Magenta]`).
    Magenta,
    /// Red (`[Red]`).
    Red,
    /// White (`[White]`).
    White,
    /// Yellow (`[Yellow]`).
    Yellow,
    /// Indexed color `[Color1]` through `[Color56]`.
    Index(u8),
}

impl std::fmt::Display for FormatColor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Black => write!(f, "Black"),
            Self::Blue => write!(f, "Blue"),
            Self::Cyan => write!(f, "Cyan"),
            Self::Green => write!(f, "Green"),
            Self::Magenta => write!(f, "Magenta"),
            Self::Red => write!(f, "Red"),
            Self::White => write!(f, "White"),
            Self::Yellow => write!(f, "Yellow"),
            Self::Index(idx) => write!(f, "Color{idx}"),
        }
    }
}

impl FormatColor {
    /// Parse a color name string (from format code brackets) into a `FormatColor`.
    ///
    /// Recognized names (case-insensitive): Black, Blue, Cyan, Green, Magenta,
    /// Red, White, Yellow. Also recognizes `ColorN` or `COLORN` for indexed
    /// colors where N is 1-56.
    ///
    /// Returns `None` if the string is not a recognized color.
    pub fn from_name(name: &str) -> Option<Self> {
        let upper = name.to_ascii_uppercase();
        match upper.as_str() {
            "BLACK" => Some(Self::Black),
            "BLUE" => Some(Self::Blue),
            "CYAN" => Some(Self::Cyan),
            "GREEN" => Some(Self::Green),
            "MAGENTA" => Some(Self::Magenta),
            "RED" => Some(Self::Red),
            "WHITE" => Some(Self::White),
            "YELLOW" => Some(Self::Yellow),
            _ => {
                // Try to parse "COLOR<N>" pattern
                if let Some(num_str) = upper.strip_prefix("COLOR")
                    && let Ok(idx) = num_str.parse::<u8>()
                    && (1..=56).contains(&idx)
                {
                    return Some(Self::Index(idx));
                }
                None
            }
        }
    }

    /// Resolve to a hex color string (e.g., `"#FF0000"` for Red).
    ///
    /// Named colors map to their standard hex values. Indexed colors look up
    /// the Excel palette. If an indexed color is out of range (should not happen
    /// if constructed via `from_name`), returns `"#000000"`.
    pub fn to_hex(&self) -> &'static str {
        match self {
            Self::Black => "#000000",
            Self::Blue => "#0000FF",
            Self::Cyan => "#00FFFF",
            Self::Green => "#008000",
            Self::Magenta => "#FF00FF",
            Self::Red => "#FF0000",
            Self::White => "#FFFFFF",
            Self::Yellow => "#FFFF00",
            Self::Index(idx) => palette_color(*idx).unwrap_or("#000000"),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- FormatColor::from_name ----

    #[test]
    fn from_name_named_colors() {
        assert_eq!(FormatColor::from_name("Red"), Some(FormatColor::Red));
        assert_eq!(FormatColor::from_name("red"), Some(FormatColor::Red));
        assert_eq!(FormatColor::from_name("RED"), Some(FormatColor::Red));
        assert_eq!(FormatColor::from_name("Blue"), Some(FormatColor::Blue));
        assert_eq!(FormatColor::from_name("Cyan"), Some(FormatColor::Cyan));
        assert_eq!(FormatColor::from_name("Green"), Some(FormatColor::Green));
        assert_eq!(
            FormatColor::from_name("Magenta"),
            Some(FormatColor::Magenta)
        );
        assert_eq!(FormatColor::from_name("White"), Some(FormatColor::White));
        assert_eq!(FormatColor::from_name("Yellow"), Some(FormatColor::Yellow));
        assert_eq!(FormatColor::from_name("Black"), Some(FormatColor::Black));
    }

    #[test]
    fn from_name_indexed_colors() {
        assert_eq!(
            FormatColor::from_name("Color1"),
            Some(FormatColor::Index(1))
        );
        assert_eq!(
            FormatColor::from_name("COLOR3"),
            Some(FormatColor::Index(3))
        );
        assert_eq!(
            FormatColor::from_name("color56"),
            Some(FormatColor::Index(56))
        );
        assert_eq!(
            FormatColor::from_name("Color10"),
            Some(FormatColor::Index(10))
        );
    }

    #[test]
    fn from_name_invalid() {
        assert_eq!(FormatColor::from_name("invalid"), None);
        assert_eq!(FormatColor::from_name(""), None);
        assert_eq!(FormatColor::from_name("Color0"), None);
        assert_eq!(FormatColor::from_name("Color57"), None);
        assert_eq!(FormatColor::from_name("Color"), None);
        assert_eq!(FormatColor::from_name("Reddish"), None);
    }

    // ---- FormatColor::to_hex ----

    #[test]
    fn to_hex_named_colors() {
        assert_eq!(FormatColor::Black.to_hex(), "#000000");
        assert_eq!(FormatColor::Blue.to_hex(), "#0000FF");
        assert_eq!(FormatColor::Cyan.to_hex(), "#00FFFF");
        assert_eq!(FormatColor::Green.to_hex(), "#008000");
        assert_eq!(FormatColor::Magenta.to_hex(), "#FF00FF");
        assert_eq!(FormatColor::Red.to_hex(), "#FF0000");
        assert_eq!(FormatColor::White.to_hex(), "#FFFFFF");
        assert_eq!(FormatColor::Yellow.to_hex(), "#FFFF00");
    }

    #[test]
    fn to_hex_indexed_colors() {
        assert_eq!(FormatColor::Index(1).to_hex(), "#000000"); // Black
        assert_eq!(FormatColor::Index(2).to_hex(), "#FFFFFF"); // White
        assert_eq!(FormatColor::Index(3).to_hex(), "#FF0000"); // Red
        assert_eq!(FormatColor::Index(5).to_hex(), "#0000FF"); // Blue
        assert_eq!(FormatColor::Index(56).to_hex(), "#333333");
    }

    // ---- palette_color ----

    #[test]
    fn palette_color_valid_range() {
        assert_eq!(palette_color(1), Some("#000000"));
        assert_eq!(palette_color(3), Some("#FF0000"));
        assert_eq!(palette_color(56), Some("#333333"));
        assert_eq!(palette_color(33), Some("#00CCFF"));
        assert_eq!(palette_color(48), Some("#969696"));
    }

    #[test]
    fn palette_color_boundaries() {
        assert_eq!(palette_color(0), None);
        assert_eq!(palette_color(57), None);
        assert_eq!(palette_color(255), None);
    }

    #[test]
    fn palette_has_56_entries() {
        assert_eq!(EXCEL_COLOR_PALETTE.len(), 56);
        // Verify indices are sequential 1..=56
        for (i, (idx, _)) in EXCEL_COLOR_PALETTE.iter().enumerate() {
            assert_eq!(*idx, (i + 1) as u8);
        }
    }

    #[test]
    fn palette_all_entries_are_valid_hex() {
        for (_, hex) in &EXCEL_COLOR_PALETTE {
            assert!(hex.starts_with('#'), "Hex should start with #: {}", hex);
            assert_eq!(hex.len(), 7, "Hex should be 7 chars: {}", hex);
            // Verify all chars after # are valid hex digits
            for c in hex[1..].chars() {
                assert!(c.is_ascii_hexdigit(), "Invalid hex char '{}' in {}", c, hex);
            }
        }
    }
}
