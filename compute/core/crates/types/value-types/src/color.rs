//! RGBA color type with validated hex parsing and consistent serialization.
//!
//! Serializes as 6-digit `#rrggbb` (opaque) or 8-digit `#aarrggbb` (with alpha).
//! Deserializes from `#rgb`, `#rrggbb`, `#aarrggbb` (Excel ARGB convention).

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

/// Error returned when a hex color string cannot be parsed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HexColorError {
    /// The hex string has an invalid length (expected 3, 6, or 8 hex digits).
    #[error("invalid hex color length: expected 3, 6, or 8 hex digits, got {0}")]
    InvalidLength(usize),
    /// The string contains a non-hex character.
    #[error("invalid hex character in color string")]
    InvalidHexChar,
}

/// RGBA color. Internal storage is `[R, G, B, A]`.
///
/// Serializes as 6-digit `#rrggbb` when fully opaque (alpha = 255),
/// or 8-digit `#aarrggbb` when alpha differs. Deserializes from
/// `#rgb`, `#rrggbb`, `#aarrggbb` (Excel/OOXML ARGB convention).
///
/// The `Display` implementation outputs `#rrggbb` for opaque colors
/// and `#aarrggbb` for colors with alpha, matching the serialization format.
/// Use [`r()`](Color::r), [`g()`](Color::g), [`b()`](Color::b),
/// [`a()`](Color::a) accessors or [`as_rgba()`](Color::as_rgba) to read
/// components. Construct via [`rgb()`](Color::rgb),
/// [`rgba()`](Color::rgba), or [`from_hex()`](Color::from_hex).
///
/// # Constants
///
/// [`Color::BLACK`] and [`Color::WHITE`] are provided for the most common
/// fully-opaque colors.
///
/// # Examples
///
/// ```
/// use value_types::Color;
///
/// let red = Color::rgb(255, 0, 0);
/// assert_eq!(format!("{red}"), "#ff0000");
///
/// let semi = Color::rgba(255, 0, 0, 128);
/// assert_eq!(format!("{semi}"), "#80ff0000");
///
/// let parsed = Color::from_hex("#ff0000").unwrap();
/// assert_eq!(parsed, red);
/// ```
#[doc(alias = "hex")]
#[doc(alias = "ARGB")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Color([u8; 4]); // [R, G, B, A]

/// Decode a single hex character to its 4-bit value.
///
/// Returns `None` for non-hex characters.
#[inline]
fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Decode two adjacent hex characters into a single byte.
#[inline]
fn hex_byte(hi: u8, lo: u8) -> Option<u8> {
    Some(hex_nibble(hi)? << 4 | hex_nibble(lo)?)
}

impl Color {
    /// Fully opaque black.
    pub const BLACK: Color = Color([0, 0, 0, 255]);

    /// Fully opaque white.
    pub const WHITE: Color = Color([255, 255, 255, 255]);

    /// Create an opaque RGB color (alpha = 255).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    ///
    /// let c = Color::rgb(255, 128, 0);
    /// assert_eq!(c.r(), 255);
    /// assert_eq!(c.g(), 128);
    /// assert_eq!(c.b(), 0);
    /// assert_eq!(c.a(), 255); // fully opaque
    /// ```
    #[inline]
    #[must_use]
    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self([r, g, b, 255])
    }

    /// Create an RGBA color with explicit alpha.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    ///
    /// let c = Color::rgba(255, 128, 0, 200);
    /// assert_eq!(c.a(), 200);
    /// ```
    #[inline]
    #[must_use]
    pub const fn rgba(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self([r, g, b, a])
    }

    /// Parse a hex color string.
    ///
    /// Accepts:
    /// - `#AARRGGBB` or `AARRGGBB` (8 digits, ARGB — Excel/OOXML convention)
    /// - `#RRGGBB` or `RRGGBB` (6 digits, opaque)
    /// - `#RGB` or `RGB` (3 digits, expanded to 6)
    ///
    /// # Errors
    ///
    /// Returns [`HexColorError::InvalidLength`] if the digit count is not 3, 6,
    /// or 8, and [`HexColorError::InvalidHexChar`] if any character is not a
    /// valid hexadecimal digit.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    ///
    /// // 6-digit hex (with or without #)
    /// assert_eq!(Color::from_hex("#ff8000"), Ok(Color::rgb(255, 128, 0)));
    /// assert_eq!(Color::from_hex("ff8000"),  Ok(Color::rgb(255, 128, 0)));
    ///
    /// // 3-digit shorthand: #f80 expands to #ff8800
    /// assert_eq!(Color::from_hex("#f80"), Ok(Color::rgb(0xff, 0x88, 0x00)));
    ///
    /// // 8-digit ARGB: first two digits are alpha
    /// assert_eq!(
    ///     Color::from_hex("#80ff8000"),
    ///     Ok(Color::rgba(255, 128, 0, 128)),
    /// );
    ///
    /// // Invalid input
    /// assert!(Color::from_hex("#xyz").is_err());
    /// assert!(Color::from_hex("").is_err());
    /// ```
    pub fn from_hex(hex_str: &str) -> Result<Self, HexColorError> {
        let hex = hex_str.strip_prefix('#').unwrap_or(hex_str);
        let b = hex.as_bytes();

        match b.len() {
            8 => {
                // ARGB format (Excel/OOXML): first two hex digits are alpha.
                let a = hex_byte(b[0], b[1]).ok_or(HexColorError::InvalidHexChar)?;
                let r = hex_byte(b[2], b[3]).ok_or(HexColorError::InvalidHexChar)?;
                let g = hex_byte(b[4], b[5]).ok_or(HexColorError::InvalidHexChar)?;
                let bl = hex_byte(b[6], b[7]).ok_or(HexColorError::InvalidHexChar)?;
                Ok(Self([r, g, bl, a]))
            }
            6 => {
                let r = hex_byte(b[0], b[1]).ok_or(HexColorError::InvalidHexChar)?;
                let g = hex_byte(b[2], b[3]).ok_or(HexColorError::InvalidHexChar)?;
                let bl = hex_byte(b[4], b[5]).ok_or(HexColorError::InvalidHexChar)?;
                Ok(Self([r, g, bl, 255]))
            }
            3 => {
                // Each nibble doubles: 0xF → 0xFF, 0x8 → 0x88.
                let rn = hex_nibble(b[0]).ok_or(HexColorError::InvalidHexChar)?;
                let gn = hex_nibble(b[1]).ok_or(HexColorError::InvalidHexChar)?;
                let bn = hex_nibble(b[2]).ok_or(HexColorError::InvalidHexChar)?;
                Ok(Self([rn << 4 | rn, gn << 4 | gn, bn << 4 | bn, 255]))
            }
            len => Err(HexColorError::InvalidLength(len)),
        }
    }

    /// Red component.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    /// assert_eq!(Color::rgb(42, 0, 0).r(), 42);
    /// ```
    #[inline]
    #[must_use]
    pub const fn r(&self) -> u8 {
        self.0[0]
    }

    /// Green component.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    /// assert_eq!(Color::rgb(0, 42, 0).g(), 42);
    /// ```
    #[inline]
    #[must_use]
    pub const fn g(&self) -> u8 {
        self.0[1]
    }

    /// Blue component.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    /// assert_eq!(Color::rgb(0, 0, 42).b(), 42);
    /// ```
    #[inline]
    #[must_use]
    pub const fn b(&self) -> u8 {
        self.0[2]
    }

    /// Alpha component (255 = fully opaque).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    /// assert_eq!(Color::rgb(0, 0, 0).a(), 255);
    /// assert_eq!(Color::rgba(0, 0, 0, 128).a(), 128);
    /// ```
    #[inline]
    #[must_use]
    pub const fn a(&self) -> u8 {
        self.0[3]
    }

    /// Return the raw `[R, G, B, A]` components.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    /// assert_eq!(Color::rgb(1, 2, 3).as_rgba(), [1, 2, 3, 255]);
    /// ```
    #[inline]
    #[must_use]
    pub const fn as_rgba(&self) -> [u8; 4] {
        self.0
    }

    /// Return a new color with the same RGB but a different alpha.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    ///
    /// let opaque = Color::rgb(255, 0, 0);
    /// let semi = opaque.with_alpha(128);
    /// assert_eq!(semi.r(), 255);
    /// assert_eq!(semi.a(), 128);
    /// ```
    #[inline]
    #[must_use]
    pub const fn with_alpha(&self, a: u8) -> Self {
        Self([self.0[0], self.0[1], self.0[2], a])
    }

    /// Format as `#rrggbb` (dropping alpha).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    /// assert_eq!(Color::rgb(255, 128, 0).to_hex_rgb(), "#ff8000");
    /// assert_eq!(Color::BLACK.to_hex_rgb(), "#000000");
    /// assert_eq!(Color::WHITE.to_hex_rgb(), "#ffffff");
    /// ```
    #[must_use]
    pub fn to_hex_rgb(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0[0], self.0[1], self.0[2])
    }

    /// Format as `#aarrggbb` (ARGB order, matching Excel convention).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::Color;
    /// assert_eq!(Color::rgba(255, 128, 0, 128).to_hex_argb(), "#80ff8000");
    /// assert_eq!(Color::rgb(255, 128, 0).to_hex_argb(), "#ffff8000");
    /// ```
    #[must_use]
    pub fn to_hex_argb(&self) -> String {
        format!(
            "#{:02x}{:02x}{:02x}{:02x}",
            self.0[3], self.0[0], self.0[1], self.0[2]
        )
    }
}

impl fmt::Display for Color {
    /// Formats as `#rrggbb` when fully opaque, `#aarrggbb` otherwise.
    ///
    /// This matches the serialization format so that
    /// `color.to_string()` and `serde_json::to_string(&color)` (sans quotes)
    /// produce the same hex string.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0[3] == 255 {
            write!(f, "#{:02x}{:02x}{:02x}", self.0[0], self.0[1], self.0[2])
        } else {
            write!(
                f,
                "#{:02x}{:02x}{:02x}{:02x}",
                self.0[3], self.0[0], self.0[1], self.0[2]
            )
        }
    }
}

impl Serialize for Color {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Reuse Display to avoid duplicate formatting logic.
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Color {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Color::from_hex(&s)
            .map_err(|e| serde::de::Error::custom(format!("invalid color: {s}: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb_constructor() {
        let c = Color::rgb(255, 128, 0);
        assert_eq!(c.r(), 255);
        assert_eq!(c.g(), 128);
        assert_eq!(c.b(), 0);
        assert_eq!(c.a(), 255);
    }

    #[test]
    fn rgba_constructor() {
        let c = Color::rgba(255, 128, 0, 200);
        assert_eq!(c.r(), 255);
        assert_eq!(c.g(), 128);
        assert_eq!(c.b(), 0);
        assert_eq!(c.a(), 200);
    }

    #[test]
    fn from_hex_6_digit() {
        let c = Color::from_hex("#ff8000").unwrap();
        assert_eq!(c, Color::rgb(255, 128, 0));
    }

    #[test]
    fn from_hex_6_digit_uppercase() {
        let c = Color::from_hex("#FF8000").unwrap();
        assert_eq!(c, Color::rgb(255, 128, 0));
    }

    #[test]
    fn from_hex_6_digit_no_hash() {
        let c = Color::from_hex("ff8000").unwrap();
        assert_eq!(c, Color::rgb(255, 128, 0));
    }

    #[test]
    fn from_hex_8_digit_argb() {
        // #80ff8000 = alpha=0x80=128, r=0xff=255, g=0x80=128, b=0x00=0
        let c = Color::from_hex("#80ff8000").unwrap();
        assert_eq!(c, Color::rgba(255, 128, 0, 128));
    }

    #[test]
    fn from_hex_8_digit_fully_opaque() {
        let c = Color::from_hex("#ffff8000").unwrap();
        assert_eq!(c, Color::rgb(255, 128, 0));
    }

    #[test]
    fn from_hex_3_digit() {
        // #f80 expands to #ff8800
        let c = Color::from_hex("#f80").unwrap();
        assert_eq!(c, Color::rgb(0xff, 0x88, 0x00));
    }

    #[test]
    fn from_hex_invalid_length() {
        assert!(Color::from_hex("").is_err());
        assert!(Color::from_hex("#").is_err());
        assert!(Color::from_hex("#12").is_err());
        assert!(Color::from_hex("#1234").is_err());
        assert!(Color::from_hex("#12345").is_err());
        assert!(Color::from_hex("#1234567").is_err());
        assert!(Color::from_hex("#123456789").is_err());
    }

    #[test]
    fn from_hex_invalid_chars() {
        assert!(Color::from_hex("#xyz").is_err());
        assert!(Color::from_hex("#gggggg").is_err());
    }

    #[test]
    fn to_hex_rgb_format() {
        assert_eq!(Color::rgb(255, 128, 0).to_hex_rgb(), "#ff8000");
        assert_eq!(Color::BLACK.to_hex_rgb(), "#000000");
        assert_eq!(Color::WHITE.to_hex_rgb(), "#ffffff");
    }

    #[test]
    fn to_hex_argb_format() {
        // alpha=128=0x80, r=255=0xff, g=128=0x80, b=0=0x00
        assert_eq!(Color::rgba(255, 128, 0, 128).to_hex_argb(), "#80ff8000");
        // Fully opaque: alpha=255=0xff
        assert_eq!(Color::rgb(255, 128, 0).to_hex_argb(), "#ffff8000");
    }

    #[test]
    fn display_opaque() {
        assert_eq!(Color::rgb(255, 128, 0).to_string(), "#ff8000");
        assert_eq!(format!("{}", Color::BLACK), "#000000");
        assert_eq!(format!("{}", Color::WHITE), "#ffffff");
    }

    #[test]
    fn display_with_alpha() {
        assert_eq!(Color::rgba(255, 128, 0, 128).to_string(), "#80ff8000");
        assert_eq!(Color::rgba(0, 0, 0, 0).to_string(), "#00000000");
    }

    #[test]
    fn display_matches_serialize() {
        for c in [
            Color::rgb(255, 128, 0),
            Color::rgba(255, 128, 0, 128),
            Color::BLACK,
            Color::WHITE,
            Color::rgba(0, 0, 0, 0),
        ] {
            let display = c.to_string();
            let json = serde_json::to_string(&c).unwrap();
            // JSON wraps in quotes: "\"#ff8000\""
            let json_inner = &json[1..json.len() - 1];
            assert_eq!(display, json_inner, "mismatch for {c:?}");
        }
    }

    #[test]
    fn serialize_opaque_as_6_digit() {
        let c = Color::rgb(255, 128, 0);
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(json, "\"#ff8000\"");
    }

    #[test]
    fn serialize_with_alpha_as_8_digit_argb() {
        let c = Color::rgba(255, 128, 0, 128);
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(json, "\"#80ff8000\"");
    }

    #[test]
    fn deserialize_6_digit() {
        let c: Color = serde_json::from_str("\"#ff8000\"").unwrap();
        assert_eq!(c, Color::rgb(255, 128, 0));
    }

    #[test]
    fn deserialize_8_digit_argb() {
        let c: Color = serde_json::from_str("\"#80ff8000\"").unwrap();
        assert_eq!(c, Color::rgba(255, 128, 0, 128));
    }

    #[test]
    fn deserialize_3_digit() {
        let c: Color = serde_json::from_str("\"#f80\"").unwrap();
        assert_eq!(c, Color::rgb(0xff, 0x88, 0x00));
    }

    #[test]
    fn deserialize_invalid() {
        let result: Result<Color, _> = serde_json::from_str("\"#xyz\"");
        assert!(result.is_err());
    }

    #[test]
    fn round_trip_opaque() {
        let c = Color::rgb(100, 200, 50);
        let json = serde_json::to_string(&c).unwrap();
        let back: Color = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn round_trip_with_alpha() {
        let c = Color::rgba(100, 200, 50, 128);
        let json = serde_json::to_string(&c).unwrap();
        let back: Color = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn round_trip_fully_transparent() {
        let c = Color::rgba(100, 200, 50, 0);
        let json = serde_json::to_string(&c).unwrap();
        let back: Color = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn constants() {
        assert_eq!(Color::BLACK, Color::rgb(0, 0, 0));
        assert_eq!(Color::WHITE, Color::rgb(255, 255, 255));
    }

    #[test]
    fn with_alpha_basic() {
        let opaque = Color::rgb(255, 0, 0);
        let semi = opaque.with_alpha(128);
        assert_eq!(semi.r(), 255);
        assert_eq!(semi.g(), 0);
        assert_eq!(semi.b(), 0);
        assert_eq!(semi.a(), 128);
    }

    #[test]
    fn with_alpha_preserves_rgb() {
        let c = Color::rgba(10, 20, 30, 40);
        let c2 = c.with_alpha(200);
        assert_eq!(c2.r(), 10);
        assert_eq!(c2.g(), 20);
        assert_eq!(c2.b(), 30);
        assert_eq!(c2.a(), 200);
    }

    #[test]
    fn with_alpha_to_opaque() {
        let semi = Color::rgba(100, 100, 100, 50);
        let opaque = semi.with_alpha(255);
        assert_eq!(opaque.a(), 255);
        assert_eq!(opaque, Color::rgb(100, 100, 100));
    }

    #[test]
    fn copy_semantics() {
        let c = Color::rgb(1, 2, 3);
        let c2 = c; // Copy
        assert_eq!(c, c2);
    }

    #[test]
    fn hash_consistency() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(Color::rgb(1, 2, 3));
        assert!(set.contains(&Color::rgb(1, 2, 3)));
        assert!(!set.contains(&Color::rgb(3, 2, 1)));
    }

    // === Property-based tests ===

    use proptest::prelude::*;

    proptest! {
        // Any RGB triple produces a valid color with alpha=255
        #[test]
        fn prop_rgb_alpha_always_opaque(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255) {
            let c = Color::rgb(r, g, b);
            prop_assert_eq!(c.a(), 255);
            prop_assert_eq!(c.r(), r);
            prop_assert_eq!(c.g(), g);
            prop_assert_eq!(c.b(), b);
        }

        // Serde roundtrip for any color
        #[test]
        fn prop_serde_roundtrip(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255, a in 0u8..=255) {
            let c = Color::rgba(r, g, b, a);
            let json = serde_json::to_string(&c).unwrap();
            let c2: Color = serde_json::from_str(&json).unwrap();
            prop_assert_eq!(c, c2);
        }

        // Display -> from_hex roundtrip
        #[test]
        fn prop_display_parse_roundtrip(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255, a in 0u8..=255) {
            let c = Color::rgba(r, g, b, a);
            let s = c.to_string();
            let c2 = Color::from_hex(&s).unwrap();
            prop_assert_eq!(c, c2);
        }
    }
}
