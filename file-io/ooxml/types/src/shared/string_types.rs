use std::fmt;

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
