/// A positive measurement with unit (ECMA-376 ST_PositiveUniversalMeasure).
///
/// Stores the raw string exactly as it appears in XML (e.g., `"210mm"`, `"8.5in"`).
/// Provides type-safe parsing, validation, and unit conversion.
///
/// # Valid formats
/// - `"210mm"` — millimeters
/// - `"8.5in"` — inches
/// - `"21cm"` — centimeters
/// - `"612pt"` — points (1/72 inch)
/// - `"914400emu"` — English Metric Units (1/914400 inch)
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct UniversalMeasure {
    raw: String,
}

/// Unit of measurement for ST_PositiveUniversalMeasure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MeasureUnit {
    /// Inches
    Inches,
    /// Millimeters
    Millimeters,
    /// Centimeters
    Centimeters,
    /// Points (1/72 inch)
    Points,
    /// Picas (1/6 inch; OOXML "pc" or "pi")
    Picas,
    /// English Metric Units (1/914400 inch)
    Emu,
}

impl UniversalMeasure {
    /// Parse from an OOXML attribute value. Returns `None` if the format is invalid.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        // Validate: must have numeric prefix + known unit suffix
        Self::parse_parts(s)?;
        Some(Self { raw: s.to_string() })
    }

    /// Create from inches.
    #[must_use]
    pub fn inches(value: f64) -> Self {
        Self {
            raw: format!("{value}in"),
        }
    }

    /// Create from millimeters.
    #[must_use]
    pub fn millimeters(value: f64) -> Self {
        Self {
            raw: format!("{value}mm"),
        }
    }

    /// Create from centimeters.
    #[must_use]
    pub fn centimeters(value: f64) -> Self {
        Self {
            raw: format!("{value}cm"),
        }
    }

    /// Create from points.
    #[must_use]
    pub fn points(value: f64) -> Self {
        Self {
            raw: format!("{value}pt"),
        }
    }

    /// Create from picas.
    #[must_use]
    pub fn picas(value: f64) -> Self {
        Self {
            raw: format!("{value}pc"),
        }
    }

    /// Get the raw OOXML string representation.
    #[must_use]
    pub fn to_ooxml(&self) -> &str {
        &self.raw
    }

    /// Convert to inches.
    #[must_use]
    pub fn to_inches(&self) -> f64 {
        let (value, unit) = Self::parse_parts(&self.raw).unwrap_or((0.0, MeasureUnit::Inches));
        match unit {
            MeasureUnit::Inches => value,
            MeasureUnit::Millimeters => value / 25.4,
            MeasureUnit::Centimeters => value / 2.54,
            MeasureUnit::Points => value / 72.0,
            MeasureUnit::Picas => value / 6.0,
            MeasureUnit::Emu => value / 914400.0,
        }
    }

    /// Convert to millimeters.
    #[must_use]
    pub fn to_mm(&self) -> f64 {
        self.to_inches() * 25.4
    }

    /// Get the unit of this measurement.
    #[must_use]
    pub fn unit(&self) -> MeasureUnit {
        Self::parse_parts(&self.raw)
            .map(|(_, u)| u)
            .unwrap_or(MeasureUnit::Inches)
    }

    /// Get the numeric value in its original unit.
    #[must_use]
    pub fn value(&self) -> f64 {
        Self::parse_parts(&self.raw).map(|(v, _)| v).unwrap_or(0.0)
    }

    fn parse_parts(s: &str) -> Option<(f64, MeasureUnit)> {
        let s = s.trim();
        // Order matters: check longer suffixes first to avoid "mm" matching "m" prefix
        if let Some(num) = s.strip_suffix("emu") {
            Some((num.parse().ok()?, MeasureUnit::Emu))
        } else if let Some(num) = s.strip_suffix("mm") {
            Some((num.parse().ok()?, MeasureUnit::Millimeters))
        } else if let Some(num) = s.strip_suffix("cm") {
            Some((num.parse().ok()?, MeasureUnit::Centimeters))
        } else if let Some(num) = s.strip_suffix("pc") {
            Some((num.parse().ok()?, MeasureUnit::Picas))
        } else if let Some(num) = s.strip_suffix("pi") {
            Some((num.parse().ok()?, MeasureUnit::Picas))
        } else if let Some(num) = s.strip_suffix("pt") {
            Some((num.parse().ok()?, MeasureUnit::Points))
        } else if let Some(num) = s.strip_suffix("in") {
            Some((num.parse().ok()?, MeasureUnit::Inches))
        } else {
            None
        }
    }
}
