//! Shared common simple types from ECMA-376 Part 4 (shared-commonSimpleTypes.xsd).
//!
//! These types are used across multiple OOXML namespaces (SpreadsheetML, WordprocessingML,
//! DrawingML) and represent fundamental value types defined in the shared schema.

use std::fmt;

// ============================================================================
// OnOff — ST_OnOff
// ============================================================================

/// Union boolean type that accepts: true/false/1/0/on/off (ST_OnOff).
///
/// This is the most common boolean representation in OOXML attributes.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum OnOff {
    /// On / true / 1.
    #[xml("true", alias = "1", alias = "on")]
    On,
    /// Off / false / 0 (default).
    #[default]
    #[xml("false", alias = "0", alias = "off")]
    Off,
}

// ============================================================================
// OnOff1 — ST_OnOff1
// ============================================================================

/// String-only boolean: "on", "off" (ST_OnOff1).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum OnOff1 {
    /// On.
    #[xml("on")]
    On,
    /// Off (default).
    #[default]
    #[xml("off")]
    Off,
}

// ============================================================================
// TrueFalse — ST_TrueFalse
// ============================================================================

/// VML boolean type: "t", "f", "true", "false" (ST_TrueFalse).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum TrueFalse {
    /// True.
    #[xml("true", alias = "t")]
    True,
    /// False (default).
    #[default]
    #[xml("false", alias = "f")]
    False,
}

// ============================================================================
// TrueFalseBlank — ST_TrueFalseBlank
// ============================================================================

/// VML boolean with blank: "t", "f", "true", "false", "", "True", "False" (ST_TrueFalseBlank).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum TrueFalseBlank {
    /// True.
    #[xml("true", alias = "t", alias = "True")]
    True,
    /// False.
    #[xml("false", alias = "f", alias = "False")]
    False,
    /// Blank (default).
    #[default]
    #[xml("")]
    Blank,
}

// ============================================================================
// Guid — ST_Guid
// ============================================================================

/// GUID in braces (ST_Guid).
///
/// Pattern: `\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}`
///
/// Stores the raw string as-is; validation is the caller's responsibility.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct Guid {
    value: String,
}

impl Guid {
    /// Create a new `Guid` from a string value.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
        }
    }

    /// Parse from an OOXML attribute value string.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        Self {
            value: s.to_owned(),
        }
    }

    /// Serialize to the OOXML attribute value string.
    #[must_use]
    pub fn to_ooxml(&self) -> &str {
        &self.value
    }

    /// Parse from raw XML attribute bytes (for the byte-level parser).
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self {
            value: String::from_utf8_lossy(bytes).into_owned(),
        }
    }

    /// Convert to string representation.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

impl fmt::Display for Guid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.value)
    }
}

// ============================================================================
// HexColorRgb — ST_HexColorRGB
// ============================================================================

/// 6-character hex color string, e.g., "FF0000" (ST_HexColorRGB).
///
/// Stores the raw string as-is; validation is the caller's responsibility.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct HexColorRgb {
    value: String,
}

impl HexColorRgb {
    /// Create a new `HexColorRgb` from a string value.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
        }
    }

    /// Parse from an OOXML attribute value string.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        Self {
            value: s.to_owned(),
        }
    }

    /// Serialize to the OOXML attribute value string.
    #[must_use]
    pub fn to_ooxml(&self) -> &str {
        &self.value
    }

    /// Parse from raw XML attribute bytes (for the byte-level parser).
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self {
            value: String::from_utf8_lossy(bytes).into_owned(),
        }
    }

    /// Convert to string representation.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.value
    }
}

impl fmt::Display for HexColorRgb {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.value)
    }
}

// ============================================================================
// XAlign — ST_XAlign
// ============================================================================

/// Horizontal alignment (ST_XAlign).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum XAlign {
    /// Left (default).
    #[default]
    #[xml("left")]
    Left,
    /// Center.
    #[xml("center")]
    Center,
    /// Right.
    #[xml("right")]
    Right,
    /// Inside.
    #[xml("inside")]
    Inside,
    /// Outside.
    #[xml("outside")]
    Outside,
}

// ============================================================================
// YAlign — ST_YAlign
// ============================================================================

/// Vertical alignment (ST_YAlign).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum YAlign {
    /// Inline.
    #[xml("inline")]
    Inline,
    /// Top (default).
    #[default]
    #[xml("top")]
    Top,
    /// Center.
    #[xml("center")]
    Center,
    /// Bottom.
    #[xml("bottom")]
    Bottom,
    /// Inside.
    #[xml("inside")]
    Inside,
    /// Outside.
    #[xml("outside")]
    Outside,
}

// ============================================================================
// ConformanceClass — ST_ConformanceClass
// ============================================================================

/// Document conformance class (ST_ConformanceClass).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum ConformanceClass {
    /// Strict conformance.
    #[xml("strict")]
    Strict,
    /// Transitional conformance (default).
    #[default]
    #[xml("transitional")]
    Transitional,
}

// ============================================================================
// AlgClass — ST_AlgClass
// ============================================================================

/// Algorithm class (ST_AlgClass).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum AlgClass {
    /// Hash algorithm (default).
    #[default]
    #[xml("hash")]
    Hash,
    /// Custom algorithm.
    #[xml("custom")]
    Custom,
}

// ============================================================================
// AlgType — ST_AlgType
// ============================================================================

/// Algorithm type (ST_AlgType).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum AlgType {
    /// Any type (default).
    #[default]
    #[xml("typeAny")]
    TypeAny,
    /// Custom type.
    #[xml("custom")]
    Custom,
}

// ============================================================================
// CryptProv — ST_CryptProv
// ============================================================================

/// Cryptographic provider type (ST_CryptProv).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum CryptProv {
    /// RSA AES provider (default).
    #[default]
    #[xml("rsaAES")]
    RsaAes,
    /// RSA Full provider.
    #[xml("rsaFull")]
    RsaFull,
    /// Custom provider.
    #[xml("custom")]
    Custom,
}

// ============================================================================
// Percentage — ST_Percentage
// ============================================================================

/// String percentage like "50%" or "-10.5%" (ST_Percentage).
///
/// Pattern: `-?[0-9]+(\.[0-9]+)?%`
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Percentage {
    value: f64,
}

impl Percentage {
    /// Create a new `Percentage` with the given value.
    #[must_use]
    pub fn new(value: f64) -> Self {
        Self { value }
    }

    /// Parse from an OOXML attribute value string (e.g., "50%", "-10.5%").
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        let trimmed = s.trim_end_matches('%');
        let value = trimmed.parse::<f64>().unwrap_or(0.0);
        Self { value }
    }

    /// Serialize to the OOXML attribute value string (e.g., "50%").
    #[must_use]
    pub fn to_ooxml(&self) -> String {
        format!("{}%", self.value)
    }

    /// Parse from raw XML attribute bytes (for the byte-level parser).
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let s = std::str::from_utf8(bytes).unwrap_or("0%");
        Self::from_ooxml(s)
    }

    /// Get the percentage value as an `f64`.
    #[must_use]
    pub fn value(&self) -> f64 {
        self.value
    }
}

impl Default for Percentage {
    fn default() -> Self {
        Self { value: 0.0 }
    }
}

// ============================================================================
// FixedPercentage — ST_FixedPercentage
// ============================================================================

/// Percentage restricted to -100..100% (ST_FixedPercentage).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FixedPercentage {
    value: f64,
}

impl FixedPercentage {
    /// Create a new `FixedPercentage`, clamping to -100.0..=100.0.
    #[must_use]
    pub fn new(value: f64) -> Self {
        Self {
            value: value.clamp(-100.0, 100.0),
        }
    }

    /// Parse from an OOXML attribute value string (e.g., "50%"), clamping to range.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        let trimmed = s.trim_end_matches('%');
        let value = trimmed.parse::<f64>().unwrap_or(0.0);
        Self::new(value)
    }

    /// Serialize to the OOXML attribute value string (e.g., "50%").
    #[must_use]
    pub fn to_ooxml(&self) -> String {
        format!("{}%", self.value)
    }

    /// Parse from raw XML attribute bytes (for the byte-level parser).
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let s = std::str::from_utf8(bytes).unwrap_or("0%");
        Self::from_ooxml(s)
    }

    /// Get the percentage value as an `f64`.
    #[must_use]
    pub fn value(&self) -> f64 {
        self.value
    }
}

impl Default for FixedPercentage {
    fn default() -> Self {
        Self { value: 0.0 }
    }
}

// ============================================================================
// PositivePercentage — ST_PositivePercentage
// ============================================================================

/// Percentage restricted to >= 0% (ST_PositivePercentage).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PositivePercentage {
    value: f64,
}

impl PositivePercentage {
    /// Create a new `PositivePercentage`, clamping to >= 0.0.
    #[must_use]
    pub fn new(value: f64) -> Self {
        Self {
            value: if value < 0.0 { 0.0 } else { value },
        }
    }

    /// Parse from an OOXML attribute value string (e.g., "50%"), clamping to range.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        let trimmed = s.trim_end_matches('%');
        let value = trimmed.parse::<f64>().unwrap_or(0.0);
        Self::new(value)
    }

    /// Serialize to the OOXML attribute value string (e.g., "50%").
    #[must_use]
    pub fn to_ooxml(&self) -> String {
        format!("{}%", self.value)
    }

    /// Parse from raw XML attribute bytes (for the byte-level parser).
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let s = std::str::from_utf8(bytes).unwrap_or("0%");
        Self::from_ooxml(s)
    }

    /// Get the percentage value as an `f64`.
    #[must_use]
    pub fn value(&self) -> f64 {
        self.value
    }
}

impl Default for PositivePercentage {
    fn default() -> Self {
        Self { value: 0.0 }
    }
}

// ============================================================================
// PositiveFixedPercentage — ST_PositiveFixedPercentage
// ============================================================================

/// Percentage restricted to 0..100% (ST_PositiveFixedPercentage).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PositiveFixedPercentage {
    value: f64,
}

impl PositiveFixedPercentage {
    /// Create a new `PositiveFixedPercentage`, clamping to 0.0..=100.0.
    #[must_use]
    pub fn new(value: f64) -> Self {
        Self {
            value: value.clamp(0.0, 100.0),
        }
    }

    /// Parse from an OOXML attribute value string (e.g., "50%"), clamping to range.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        let trimmed = s.trim_end_matches('%');
        let value = trimmed.parse::<f64>().unwrap_or(0.0);
        Self::new(value)
    }

    /// Serialize to the OOXML attribute value string (e.g., "50%").
    #[must_use]
    pub fn to_ooxml(&self) -> String {
        format!("{}%", self.value)
    }

    /// Parse from raw XML attribute bytes (for the byte-level parser).
    #[must_use]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let s = std::str::from_utf8(bytes).unwrap_or("0%");
        Self::from_ooxml(s)
    }

    /// Get the percentage value as an `f64`.
    #[must_use]
    pub fn value(&self) -> f64 {
        self.value
    }
}

impl Default for PositiveFixedPercentage {
    fn default() -> Self {
        Self { value: 0.0 }
    }
}

// ============================================================================
// VerticalAlignRun — ST_VerticalAlignRun
// ============================================================================

/// Vertical alignment for a text run (ECMA-376 ST_VerticalAlignRun).
///
/// Controls superscript/subscript positioning within rich text.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum VerticalAlignRun {
    /// Normal baseline text (default).
    #[default]
    #[xml("baseline")]
    Baseline,
    /// Superscript text.
    #[xml("superscript")]
    Superscript,
    /// Subscript text.
    #[xml("subscript")]
    Subscript,
}

// ============================================================================
// OpcRelationship — OPC Relationship entry
// ============================================================================

/// A single OPC (Open Packaging Conventions) relationship entry from a `.rels` file.
///
/// OOXML packages use `.rels` files to define relationships between parts.
/// Each relationship maps an ID (e.g., `rId1`) to a target path and type URI.
/// Preserving the original relationships during round-trip avoids renumbering
/// IDs and reordering entries, which can break external references.
///
/// Reference: ECMA-376 Part 2, §9 (Relationships).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct OpcRelationship {
    /// Relationship ID (e.g., "rId1", "rId3").
    pub id: String,
    /// Relationship type URI (e.g., "http://schemas.openxmlformats.org/.../worksheet").
    pub rel_type: String,
    /// Target path or URL (e.g., "worksheets/sheet1.xml", "https://example.com").
    pub target: String,
    /// Target mode — `Some("External")` for external resources (hyperlinks, etc.),
    /// `None` for internal package parts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------------
    // OnOff
    // ------------------------------------------------------------------------

    #[test]
    fn on_off_default() {
        assert_eq!(OnOff::default(), OnOff::Off);
    }

    #[test]
    fn on_off_from_ooxml_all_forms() {
        assert_eq!(OnOff::from_ooxml("true"), OnOff::On);
        assert_eq!(OnOff::from_ooxml("1"), OnOff::On);
        assert_eq!(OnOff::from_ooxml("on"), OnOff::On);
        assert_eq!(OnOff::from_ooxml("false"), OnOff::Off);
        assert_eq!(OnOff::from_ooxml("0"), OnOff::Off);
        assert_eq!(OnOff::from_ooxml("off"), OnOff::Off);
    }

    #[test]
    fn on_off_unknown_defaults_to_off() {
        assert_eq!(OnOff::from_ooxml("yes"), OnOff::Off);
        assert_eq!(OnOff::from_ooxml(""), OnOff::Off);
    }

    #[test]
    fn on_off_roundtrip() {
        assert_eq!(OnOff::from_ooxml(OnOff::On.to_ooxml()), OnOff::On);
        assert_eq!(OnOff::from_ooxml(OnOff::Off.to_ooxml()), OnOff::Off);
    }

    #[test]
    fn on_off_from_bytes() {
        assert_eq!(OnOff::from_bytes(b"true"), OnOff::On);
        assert_eq!(OnOff::from_bytes(b"1"), OnOff::On);
        assert_eq!(OnOff::from_bytes(b"on"), OnOff::On);
        assert_eq!(OnOff::from_bytes(b"false"), OnOff::Off);
        assert_eq!(OnOff::from_bytes(b"0"), OnOff::Off);
        assert_eq!(OnOff::from_bytes(b"off"), OnOff::Off);
    }

    #[test]
    fn on_off_as_str() {
        assert_eq!(OnOff::On.as_str(), "true");
        assert_eq!(OnOff::Off.as_str(), "false");
    }

    // ------------------------------------------------------------------------
    // OnOff1
    // ------------------------------------------------------------------------

    #[test]
    fn on_off1_default() {
        assert_eq!(OnOff1::default(), OnOff1::Off);
    }

    #[test]
    fn on_off1_roundtrip() {
        assert_eq!(OnOff1::from_ooxml(OnOff1::On.to_ooxml()), OnOff1::On);
        assert_eq!(OnOff1::from_ooxml(OnOff1::Off.to_ooxml()), OnOff1::Off);
    }

    #[test]
    fn on_off1_unknown_defaults_to_off() {
        assert_eq!(OnOff1::from_ooxml("true"), OnOff1::Off);
    }

    // ------------------------------------------------------------------------
    // TrueFalse
    // ------------------------------------------------------------------------

    #[test]
    fn true_false_default() {
        assert_eq!(TrueFalse::default(), TrueFalse::False);
    }

    #[test]
    fn true_false_from_ooxml() {
        assert_eq!(TrueFalse::from_ooxml("t"), TrueFalse::True);
        assert_eq!(TrueFalse::from_ooxml("true"), TrueFalse::True);
        assert_eq!(TrueFalse::from_ooxml("f"), TrueFalse::False);
        assert_eq!(TrueFalse::from_ooxml("false"), TrueFalse::False);
    }

    #[test]
    fn true_false_roundtrip() {
        assert_eq!(
            TrueFalse::from_ooxml(TrueFalse::True.to_ooxml()),
            TrueFalse::True
        );
        assert_eq!(
            TrueFalse::from_ooxml(TrueFalse::False.to_ooxml()),
            TrueFalse::False
        );
    }

    #[test]
    fn true_false_unknown_defaults_to_false() {
        assert_eq!(TrueFalse::from_ooxml("yes"), TrueFalse::False);
    }

    // ------------------------------------------------------------------------
    // TrueFalseBlank
    // ------------------------------------------------------------------------

    #[test]
    fn true_false_blank_default() {
        assert_eq!(TrueFalseBlank::default(), TrueFalseBlank::Blank);
    }

    #[test]
    fn true_false_blank_from_ooxml() {
        assert_eq!(TrueFalseBlank::from_ooxml("t"), TrueFalseBlank::True);
        assert_eq!(TrueFalseBlank::from_ooxml("true"), TrueFalseBlank::True);
        assert_eq!(TrueFalseBlank::from_ooxml("True"), TrueFalseBlank::True);
        assert_eq!(TrueFalseBlank::from_ooxml("f"), TrueFalseBlank::False);
        assert_eq!(TrueFalseBlank::from_ooxml("false"), TrueFalseBlank::False);
        assert_eq!(TrueFalseBlank::from_ooxml("False"), TrueFalseBlank::False);
    }

    #[test]
    fn true_false_blank_empty_is_blank() {
        assert_eq!(TrueFalseBlank::from_ooxml(""), TrueFalseBlank::Blank);
    }

    #[test]
    fn true_false_blank_unknown_is_blank() {
        assert_eq!(TrueFalseBlank::from_ooxml("xyz"), TrueFalseBlank::Blank);
    }

    #[test]
    fn true_false_blank_roundtrip() {
        assert_eq!(
            TrueFalseBlank::from_ooxml(TrueFalseBlank::True.to_ooxml()),
            TrueFalseBlank::True
        );
        assert_eq!(
            TrueFalseBlank::from_ooxml(TrueFalseBlank::False.to_ooxml()),
            TrueFalseBlank::False
        );
        // Blank round-trips through "" which maps back to Blank.
        assert_eq!(
            TrueFalseBlank::from_ooxml(TrueFalseBlank::Blank.to_ooxml()),
            TrueFalseBlank::Blank
        );
    }

    // ------------------------------------------------------------------------
    // Guid
    // ------------------------------------------------------------------------

    #[test]
    fn guid_new_and_as_str() {
        let guid = Guid::new("{12345678-1234-1234-1234-123456789ABC}");
        assert_eq!(guid.as_str(), "{12345678-1234-1234-1234-123456789ABC}");
    }

    #[test]
    fn guid_from_ooxml_roundtrip() {
        let s = "{ABCDEF01-2345-6789-ABCD-EF0123456789}";
        let guid = Guid::from_ooxml(s);
        assert_eq!(guid.to_ooxml(), s);
    }

    #[test]
    fn guid_from_bytes() {
        let guid = Guid::from_bytes(b"{00000000-0000-0000-0000-000000000000}");
        assert_eq!(guid.as_str(), "{00000000-0000-0000-0000-000000000000}");
    }

    #[test]
    fn guid_display() {
        let guid = Guid::new("{AABBCCDD-1122-3344-5566-778899AABBCC}");
        assert_eq!(format!("{guid}"), "{AABBCCDD-1122-3344-5566-778899AABBCC}");
    }

    // ------------------------------------------------------------------------
    // HexColorRgb
    // ------------------------------------------------------------------------

    #[test]
    fn hex_color_rgb_new_and_as_str() {
        let color = HexColorRgb::new("FF0000");
        assert_eq!(color.as_str(), "FF0000");
    }

    #[test]
    fn hex_color_rgb_from_ooxml_roundtrip() {
        let color = HexColorRgb::from_ooxml("00FF00");
        assert_eq!(color.to_ooxml(), "00FF00");
    }

    #[test]
    fn hex_color_rgb_from_bytes() {
        let color = HexColorRgb::from_bytes(b"0000FF");
        assert_eq!(color.as_str(), "0000FF");
    }

    #[test]
    fn hex_color_rgb_display() {
        let color = HexColorRgb::new("ABCDEF");
        assert_eq!(format!("{color}"), "ABCDEF");
    }

    // ------------------------------------------------------------------------
    // XAlign
    // ------------------------------------------------------------------------

    #[test]
    fn x_align_default() {
        assert_eq!(XAlign::default(), XAlign::Left);
    }

    #[test]
    fn x_align_roundtrip() {
        for variant in [
            XAlign::Left,
            XAlign::Center,
            XAlign::Right,
            XAlign::Inside,
            XAlign::Outside,
        ] {
            assert_eq!(XAlign::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    // ------------------------------------------------------------------------
    // YAlign
    // ------------------------------------------------------------------------

    #[test]
    fn y_align_default() {
        assert_eq!(YAlign::default(), YAlign::Top);
    }

    #[test]
    fn y_align_roundtrip() {
        for variant in [
            YAlign::Inline,
            YAlign::Top,
            YAlign::Center,
            YAlign::Bottom,
            YAlign::Inside,
            YAlign::Outside,
        ] {
            assert_eq!(YAlign::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    // ------------------------------------------------------------------------
    // ConformanceClass
    // ------------------------------------------------------------------------

    #[test]
    fn conformance_class_default() {
        assert_eq!(ConformanceClass::default(), ConformanceClass::Transitional);
    }

    #[test]
    fn conformance_class_roundtrip() {
        assert_eq!(
            ConformanceClass::from_ooxml(ConformanceClass::Strict.to_ooxml()),
            ConformanceClass::Strict
        );
        assert_eq!(
            ConformanceClass::from_ooxml(ConformanceClass::Transitional.to_ooxml()),
            ConformanceClass::Transitional
        );
    }

    // ------------------------------------------------------------------------
    // AlgClass
    // ------------------------------------------------------------------------

    #[test]
    fn alg_class_default() {
        assert_eq!(AlgClass::default(), AlgClass::Hash);
    }

    #[test]
    fn alg_class_roundtrip() {
        assert_eq!(
            AlgClass::from_ooxml(AlgClass::Hash.to_ooxml()),
            AlgClass::Hash
        );
        assert_eq!(
            AlgClass::from_ooxml(AlgClass::Custom.to_ooxml()),
            AlgClass::Custom
        );
    }

    // ------------------------------------------------------------------------
    // AlgType
    // ------------------------------------------------------------------------

    #[test]
    fn alg_type_default() {
        assert_eq!(AlgType::default(), AlgType::TypeAny);
    }

    #[test]
    fn alg_type_roundtrip() {
        assert_eq!(
            AlgType::from_ooxml(AlgType::TypeAny.to_ooxml()),
            AlgType::TypeAny
        );
        assert_eq!(
            AlgType::from_ooxml(AlgType::Custom.to_ooxml()),
            AlgType::Custom
        );
    }

    #[test]
    fn alg_type_camel_case() {
        assert_eq!(AlgType::from_ooxml("typeAny"), AlgType::TypeAny);
        assert_eq!(AlgType::TypeAny.to_ooxml(), "typeAny");
    }

    // ------------------------------------------------------------------------
    // CryptProv
    // ------------------------------------------------------------------------

    #[test]
    fn crypt_prov_default() {
        assert_eq!(CryptProv::default(), CryptProv::RsaAes);
    }

    #[test]
    fn crypt_prov_roundtrip() {
        assert_eq!(
            CryptProv::from_ooxml(CryptProv::RsaAes.to_ooxml()),
            CryptProv::RsaAes
        );
        assert_eq!(
            CryptProv::from_ooxml(CryptProv::RsaFull.to_ooxml()),
            CryptProv::RsaFull
        );
        assert_eq!(
            CryptProv::from_ooxml(CryptProv::Custom.to_ooxml()),
            CryptProv::Custom
        );
    }

    #[test]
    fn crypt_prov_case_sensitive() {
        assert_eq!(CryptProv::from_ooxml("rsaAES"), CryptProv::RsaAes);
        assert_eq!(CryptProv::from_ooxml("rsaFull"), CryptProv::RsaFull);
    }

    // ------------------------------------------------------------------------
    // Percentage
    // ------------------------------------------------------------------------

    #[test]
    fn percentage_default() {
        assert!((Percentage::default().value() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn percentage_new_and_value() {
        let p = Percentage::new(50.0);
        assert!((p.value() - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn percentage_from_ooxml() {
        let p = Percentage::from_ooxml("50%");
        assert!((p.value() - 50.0).abs() < f64::EPSILON);

        let p = Percentage::from_ooxml("-10.5%");
        assert!((p.value() - (-10.5)).abs() < f64::EPSILON);
    }

    #[test]
    fn percentage_to_ooxml() {
        let p = Percentage::new(50.0);
        assert_eq!(p.to_ooxml(), "50%");
    }

    #[test]
    fn percentage_invalid_defaults_to_zero() {
        let p = Percentage::from_ooxml("abc%");
        assert!((p.value() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn percentage_from_bytes() {
        let p = Percentage::from_bytes(b"75%");
        assert!((p.value() - 75.0).abs() < f64::EPSILON);
    }

    // ------------------------------------------------------------------------
    // FixedPercentage
    // ------------------------------------------------------------------------

    #[test]
    fn fixed_percentage_clamps_high() {
        let p = FixedPercentage::new(200.0);
        assert!((p.value() - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn fixed_percentage_clamps_low() {
        let p = FixedPercentage::new(-200.0);
        assert!((p.value() - (-100.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn fixed_percentage_in_range() {
        let p = FixedPercentage::new(50.0);
        assert!((p.value() - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn fixed_percentage_from_ooxml() {
        let p = FixedPercentage::from_ooxml("150%");
        assert!((p.value() - 100.0).abs() < f64::EPSILON);
    }

    // ------------------------------------------------------------------------
    // PositivePercentage
    // ------------------------------------------------------------------------

    #[test]
    fn positive_percentage_clamps_negative() {
        let p = PositivePercentage::new(-50.0);
        assert!((p.value() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn positive_percentage_allows_large() {
        let p = PositivePercentage::new(500.0);
        assert!((p.value() - 500.0).abs() < f64::EPSILON);
    }

    #[test]
    fn positive_percentage_from_ooxml() {
        let p = PositivePercentage::from_ooxml("-25%");
        assert!((p.value() - 0.0).abs() < f64::EPSILON);
    }

    // ------------------------------------------------------------------------
    // PositiveFixedPercentage
    // ------------------------------------------------------------------------

    #[test]
    fn positive_fixed_percentage_clamps_negative() {
        let p = PositiveFixedPercentage::new(-10.0);
        assert!((p.value() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn positive_fixed_percentage_clamps_high() {
        let p = PositiveFixedPercentage::new(150.0);
        assert!((p.value() - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn positive_fixed_percentage_in_range() {
        let p = PositiveFixedPercentage::new(75.0);
        assert!((p.value() - 75.0).abs() < f64::EPSILON);
    }

    #[test]
    fn positive_fixed_percentage_from_ooxml() {
        let p = PositiveFixedPercentage::from_ooxml("200%");
        assert!((p.value() - 100.0).abs() < f64::EPSILON);

        let p = PositiveFixedPercentage::from_ooxml("-5%");
        assert!((p.value() - 0.0).abs() < f64::EPSILON);
    }

    // ------------------------------------------------------------------------
    // VerticalAlignRun
    // ------------------------------------------------------------------------

    #[test]
    fn vertical_align_run_default() {
        assert_eq!(VerticalAlignRun::default(), VerticalAlignRun::Baseline);
    }

    #[test]
    fn vertical_align_run_roundtrip() {
        for (s, v) in [
            ("baseline", VerticalAlignRun::Baseline),
            ("superscript", VerticalAlignRun::Superscript),
            ("subscript", VerticalAlignRun::Subscript),
        ] {
            assert_eq!(VerticalAlignRun::from_ooxml(s), v);
            assert_eq!(v.to_ooxml(), s);
            assert_eq!(VerticalAlignRun::from_bytes(s.as_bytes()), v);
            assert_eq!(v.as_str(), s);
        }
    }

    #[test]
    fn vertical_align_run_unknown_defaults_to_baseline() {
        assert_eq!(
            VerticalAlignRun::from_ooxml("unknown"),
            VerticalAlignRun::Baseline
        );
        assert_eq!(
            VerticalAlignRun::from_bytes(b"unknown"),
            VerticalAlignRun::Baseline
        );
    }
}
