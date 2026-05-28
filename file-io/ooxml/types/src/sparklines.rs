//! Sparkline types (ECMA-376 x14:sparklineGroups extension, Excel 2010+).
//!
//! Unified from xlsx-parser read (`read/sparklines.rs`) and write
//! (`write/sparklines_writer.rs`) sides. These types represent the shared
//! vocabulary; parsing and serialisation logic stays in each respective module.
//! x14 extension payloads remain owner-scoped preservation state unless the
//! parser/writer path explicitly models and validates them.

// ============================================================================
// SparklineType (ST_SparklineType)
// ============================================================================

/// Sparkline type enumeration (ST_SparklineType).
///
/// Defines the visual representation style of the sparkline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SparklineType {
    /// Line sparkline — data points connected with lines (default).
    #[default]
    Line,
    /// Column sparkline — data shown as vertical bars.
    Column,
    /// Win/Loss sparkline — binary representation (up/down bars).
    WinLoss,
}

impl SparklineType {
    /// Parse from an OOXML attribute value (`&str`).
    ///
    /// Returns `Line` for unrecognised values, matching Excel's default.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "line" => Self::Line,
            "column" => Self::Column,
            "stacked" | "winLoss" => Self::WinLoss,
            _ => Self::Line,
        }
    }

    /// Parse from raw XML attribute bytes (zero-copy fast path for the reader).
    pub fn from_ooxml_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"line" => Self::Line,
            b"column" => Self::Column,
            b"stacked" | b"winLoss" => Self::WinLoss,
            _ => Self::Line,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Line => "line",
            Self::Column => "column",
            Self::WinLoss => "stacked",
        }
    }

    /// Alias for [`Self::from_ooxml_bytes`] used by `xml-derive` generated code.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self::from_ooxml_bytes(bytes)
    }

    /// Alias for [`Self::to_ooxml`] used by `xml-derive` generated code.
    pub fn as_str(&self) -> &'static str {
        self.to_ooxml()
    }
}

// ============================================================================
// SparklineAxisType
// ============================================================================

/// Axis display options for min/max axis scaling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SparklineAxisType {
    /// Each sparkline has its own min/max (default).
    #[default]
    Individual,
    /// All sparklines in group share min/max.
    Group,
    /// Use manually specified min/max.
    Custom,
}

impl SparklineAxisType {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "individual" => Self::Individual,
            "group" => Self::Group,
            "custom" => Self::Custom,
            _ => Self::Individual,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Individual => "individual",
            Self::Group => "group",
            Self::Custom => "custom",
        }
    }

    /// Parse from raw XML attribute bytes.
    pub fn from_ooxml_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"individual" => Self::Individual,
            b"group" => Self::Group,
            b"custom" => Self::Custom,
            _ => Self::Individual,
        }
    }

    /// Alias for [`Self::from_ooxml_bytes`] used by `xml-derive` generated code.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self::from_ooxml_bytes(bytes)
    }

    /// Alias for [`Self::to_ooxml`] used by `xml-derive` generated code.
    pub fn as_str(&self) -> &'static str {
        self.to_ooxml()
    }
}

// ============================================================================
// DisplayEmptyCellsAs (ST_DispBlanksAs)
// ============================================================================

/// How to display empty cells in the source data (ST_DispBlanksAs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum DisplayEmptyCellsAs {
    /// Display as a gap in the sparkline (default).
    #[default]
    Gap,
    /// Display as zero value.
    Zero,
    /// Connect data points across empty cells (span).
    Span,
}

impl DisplayEmptyCellsAs {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "gap" => Self::Gap,
            "zero" => Self::Zero,
            "span" => Self::Span,
            _ => Self::Gap,
        }
    }

    /// Parse from raw XML attribute bytes (zero-copy fast path for the reader).
    pub fn from_ooxml_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"gap" => Self::Gap,
            b"zero" => Self::Zero,
            b"span" => Self::Span,
            _ => Self::Gap,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Gap => "gap",
            Self::Zero => "zero",
            Self::Span => "span",
        }
    }

    /// Alias for [`Self::from_ooxml_bytes`] used by `xml-derive` generated code.
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self::from_ooxml_bytes(bytes)
    }

    /// Alias for [`Self::to_ooxml`] used by `xml-derive` generated code.
    pub fn as_str(&self) -> &'static str {
        self.to_ooxml()
    }
}

// ============================================================================
// SparklineColor
// ============================================================================

/// Sparkline color with ARGB or theme reference.
///
/// Colors in sparklines can be specified as RGB hex values or theme color
/// references with optional tint adjustment.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SparklineColor {
    /// RGB color value in ARGB hex format (e.g., "FF376092").
    pub rgb: Option<String>,
    /// Theme color index (0-based).
    pub theme: Option<u32>,
    /// Tint value for theme colors (-1.0 to 1.0).
    pub tint: Option<f64>,
}

impl SparklineColor {
    /// Create a color from an RGB hex string.
    pub fn from_rgb(rgb: &str) -> Self {
        Self {
            rgb: Some(rgb.to_string()),
            theme: None,
            tint: None,
        }
    }

    /// Check if this color has any value set.
    pub fn is_empty(&self) -> bool {
        self.rgb.is_none() && self.theme.is_none()
    }
}

// ============================================================================
// Sparkline (Individual Entry)
// ============================================================================

/// Individual sparkline entry within a group.
///
/// Each sparkline has a source data range and a target cell location.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Sparkline {
    /// Source data range formula (e.g., "Sheet1!A1:A10").
    pub data_range: String,
    /// Target cell location reference (e.g., "B1").
    pub location: String,
}

impl Sparkline {
    /// Create a new sparkline entry.
    pub fn new(data_range: &str, location: &str) -> Self {
        Self {
            data_range: data_range.to_string(),
            location: location.to_string(),
        }
    }
}

// ============================================================================
// SparklineGroup
// ============================================================================

/// Sparkline group containing shared settings and individual sparkline entries.
///
/// A sparkline group defines common visual settings that apply to all sparklines
/// within the group, plus a collection of individual sparkline definitions.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SparklineGroup {
    // Type and display settings
    /// Sparkline type (line, column, or win/loss).
    pub sparkline_type: SparklineType,
    /// How to display empty cells in the source data.
    pub display_empty_cells_as: DisplayEmptyCellsAs,

    // Color settings (using SparklineColor for full theme support)
    /// Main series color.
    pub color_series: Option<SparklineColor>,
    /// Color for negative values.
    pub color_negative: Option<SparklineColor>,
    /// Axis line color.
    pub color_axis: Option<SparklineColor>,
    /// Color for all data point markers.
    pub color_markers: Option<SparklineColor>,
    /// Color for the first data point marker.
    pub color_first: Option<SparklineColor>,
    /// Color for the last data point marker.
    pub color_last: Option<SparklineColor>,
    /// Color for the highest data point marker.
    pub color_high: Option<SparklineColor>,
    /// Color for the lowest data point marker.
    pub color_low: Option<SparklineColor>,

    // Axis settings
    /// Whether to display the X-axis.
    pub display_x_axis: bool,
    /// Whether to display hidden rows/columns.
    pub display_hidden: bool,
    /// Right-to-left rendering.
    pub right_to_left: bool,
    /// Manual maximum value for Y-axis.
    pub manual_max: Option<f64>,
    /// Manual minimum value for Y-axis.
    pub manual_min: Option<f64>,
    /// Date axis range reference (e.g., "Sheet1!A1:A10"), or empty if not a date axis.
    pub date_axis: Option<String>,

    // Marker visibility settings
    /// Show markers on all data points.
    pub markers: bool,
    /// Show marker on high point.
    pub high: bool,
    /// Show marker on low point.
    pub low: bool,
    /// Show marker on first point.
    pub first: bool,
    /// Show marker on last point.
    pub last: bool,
    /// Show markers on negative values.
    pub negative: bool,

    // Line weight (line sparklines only)
    /// Line width in points (e.g., 0.75).
    pub line_weight: Option<f64>,

    // Min/Max axis type options
    /// Minimum axis type.
    pub min_axis_type: SparklineAxisType,
    /// Maximum axis type.
    pub max_axis_type: SparklineAxisType,

    // Individual sparklines in this group
    /// Collection of sparkline entries.
    pub sparklines: Vec<Sparkline>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparkline_type_roundtrip() {
        for ty in [
            SparklineType::Line,
            SparklineType::Column,
            SparklineType::WinLoss,
        ] {
            assert_eq!(SparklineType::from_ooxml(ty.to_ooxml()), ty);
        }
    }

    #[test]
    fn sparkline_type_from_bytes() {
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"column"),
            SparklineType::Column
        );
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"stacked"),
            SparklineType::WinLoss
        );
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"winLoss"),
            SparklineType::WinLoss
        );
        assert_eq!(
            SparklineType::from_ooxml_bytes(b"unknown"),
            SparklineType::Line
        );
    }

    #[test]
    fn sparkline_type_default() {
        assert_eq!(SparklineType::default(), SparklineType::Line);
    }

    #[test]
    fn axis_type_roundtrip() {
        for ty in [
            SparklineAxisType::Individual,
            SparklineAxisType::Group,
            SparklineAxisType::Custom,
        ] {
            assert_eq!(SparklineAxisType::from_ooxml(ty.to_ooxml()), ty);
        }
    }

    #[test]
    fn axis_type_default() {
        assert_eq!(SparklineAxisType::default(), SparklineAxisType::Individual);
    }

    #[test]
    fn display_empty_cells_roundtrip() {
        for mode in [
            DisplayEmptyCellsAs::Gap,
            DisplayEmptyCellsAs::Zero,
            DisplayEmptyCellsAs::Span,
        ] {
            assert_eq!(DisplayEmptyCellsAs::from_ooxml(mode.to_ooxml()), mode);
        }
    }

    #[test]
    fn display_empty_cells_from_bytes() {
        assert_eq!(
            DisplayEmptyCellsAs::from_ooxml_bytes(b"zero"),
            DisplayEmptyCellsAs::Zero
        );
        assert_eq!(
            DisplayEmptyCellsAs::from_ooxml_bytes(b"span"),
            DisplayEmptyCellsAs::Span
        );
        assert_eq!(
            DisplayEmptyCellsAs::from_ooxml_bytes(b"unknown"),
            DisplayEmptyCellsAs::Gap
        );
    }

    #[test]
    fn display_empty_cells_default() {
        assert_eq!(DisplayEmptyCellsAs::default(), DisplayEmptyCellsAs::Gap);
    }

    #[test]
    fn sparkline_color_from_rgb() {
        let color = SparklineColor::from_rgb("FF376092");
        assert_eq!(color.rgb, Some("FF376092".to_string()));
        assert!(!color.is_empty());
    }

    #[test]
    fn sparkline_color_empty() {
        let color = SparklineColor::default();
        assert!(color.is_empty());
    }

    #[test]
    fn sparkline_new() {
        let s = Sparkline::new("Sheet1!A1:A10", "B1");
        assert_eq!(s.data_range, "Sheet1!A1:A10");
        assert_eq!(s.location, "B1");
    }

    #[test]
    fn sparkline_group_defaults() {
        let g = SparklineGroup::default();
        assert_eq!(g.sparkline_type, SparklineType::Line);
        assert_eq!(g.display_empty_cells_as, DisplayEmptyCellsAs::Gap);
        assert_eq!(g.min_axis_type, SparklineAxisType::Individual);
        assert_eq!(g.max_axis_type, SparklineAxisType::Individual);
        assert!(g.sparklines.is_empty());
        assert!(!g.markers);
        assert!(!g.high);
        assert!(!g.low);
        assert!(!g.first);
        assert!(!g.last);
        assert!(!g.negative);
    }
}
