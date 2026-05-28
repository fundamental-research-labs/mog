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
