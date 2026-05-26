//! Sparkline XML types — local structs with `#[derive(XmlRead, XmlWrite)]`.
//!
//! These types mirror the canonical `ooxml_types::sparklines` types but carry
//! derive-macro annotations for automatic XML parse/write code generation.
//! Conversion to/from the canonical types is provided via `From` impls.

use xml_derive::XmlRead;

use ooxml_types::sparklines::{
    DisplayEmptyCellsAs, SparklineAxisType, SparklineColor, SparklineType,
};

// ============================================================================
// XmlSparklineColor — maps to <x14:colorSeries>, <x14:colorNegative>, etc.
//
// NOTE: SparklineColor is used with 8 different tag names, so we *cannot*
// derive XmlWrite (which bakes in a single tag). Instead, each colour element
// is a thin wrapper with its own tag — see `color_series`, `color_negative`,
// etc. fields on `XmlSparklineGroup`.
//
// For *parsing*, a single derive-able struct suffices because the caller
// extracts the relevant sub-slice before calling xml_parse.
// ============================================================================

/// Sparkline color — parse-only derive (tag is arbitrary; caller extracts the slice).
#[derive(Debug, Clone, Default, XmlRead)]
#[xml(tag = "color")]
pub struct XmlSparklineColor {
    #[xml(attr = "rgb")]
    pub rgb: Option<String>,
    #[xml(attr = "theme", num)]
    pub theme: Option<u32>,
    #[xml(attr = "tint", num)]
    pub tint: Option<f64>,
}

impl From<XmlSparklineColor> for Option<SparklineColor> {
    fn from(c: XmlSparklineColor) -> Self {
        if c.rgb.is_none() && c.theme.is_none() {
            None
        } else {
            Some(SparklineColor {
                rgb: c.rgb,
                theme: c.theme,
                tint: c.tint,
            })
        }
    }
}

// ============================================================================
// XmlSparkline — maps to <x14:sparkline>
// ============================================================================

/// A single sparkline entry with data range and location.
#[derive(Debug, Clone, Default, XmlRead)]
#[xml(tag = "x14:sparkline")]
pub struct XmlSparkline {
    #[xml(child = "f", text)]
    pub data_range: String,
    #[xml(child = "sqref", text)]
    pub location: String,
}

impl From<XmlSparkline> for ooxml_types::sparklines::Sparkline {
    fn from(s: XmlSparkline) -> Self {
        Self {
            data_range: s.data_range,
            location: s.location,
        }
    }
}

impl From<&ooxml_types::sparklines::Sparkline> for XmlSparkline {
    fn from(s: &ooxml_types::sparklines::Sparkline) -> Self {
        Self {
            data_range: s.data_range.clone(),
            location: s.location.clone(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SparklineGroupColors {
    pub color_series: Option<SparklineColor>,
    pub color_negative: Option<SparklineColor>,
    pub color_axis: Option<SparklineColor>,
    pub color_markers: Option<SparklineColor>,
    pub color_first: Option<SparklineColor>,
    pub color_last: Option<SparklineColor>,
    pub color_high: Option<SparklineColor>,
    pub color_low: Option<SparklineColor>,
}

// ============================================================================
// XmlSparklineGroup — maps to <x14:sparklineGroup>
//
// The derive handles all attributes. Color child elements and sparkline list
// are written/read manually because:
//   - Each color element has a different tag name but the same struct type
//   - The <sparklines> wrapper element needs special handling
// ============================================================================

/// Sparkline group with attribute-level derive support.
///
/// Attributes are derived; child elements (colors, sparkline list) are handled
/// by the hand-coded `parse_children` / `write_children` helpers.
#[derive(Debug, Clone, Default, XmlRead)]
#[xml(tag = "sparklineGroup")]
pub struct XmlSparklineGroup {
    #[xml(attr = "type", enum, skip_default)]
    pub sparkline_type: SparklineType,
    #[xml(attr = "displayEmptyCellsAs", enum, skip_default)]
    pub display_empty_cells_as: DisplayEmptyCellsAs,
    #[xml(attr = "markers", bool)]
    pub markers: bool,
    #[xml(attr = "high", bool)]
    pub high: bool,
    #[xml(attr = "low", bool)]
    pub low: bool,
    #[xml(attr = "first", bool)]
    pub first: bool,
    #[xml(attr = "last", bool)]
    pub last: bool,
    #[xml(attr = "negative", bool)]
    pub negative: bool,
    #[xml(attr = "displayXAxis", bool)]
    pub display_x_axis: bool,
    #[xml(attr = "displayHidden", bool)]
    pub display_hidden: bool,
    #[xml(attr = "rightToLeft", bool)]
    pub right_to_left: bool,
    #[xml(attr = "dateAxis", bool)]
    pub date_axis: bool,
    #[xml(attr = "lineWeight", num)]
    pub line_weight: Option<f64>,
    #[xml(attr = "minAxisType", enum, skip_default)]
    pub min_axis_type: SparklineAxisType,
    #[xml(attr = "maxAxisType", enum, skip_default)]
    pub max_axis_type: SparklineAxisType,
    #[xml(attr = "manualMin", num)]
    pub manual_min: Option<f64>,
    #[xml(attr = "manualMax", num)]
    pub manual_max: Option<f64>,
}

impl XmlSparklineGroup {
    /// Convert to the canonical `SparklineGroup`, merging in children parsed separately.
    pub fn into_sparkline_group(
        self,
        colors: SparklineGroupColors,
        sparklines: Vec<ooxml_types::sparklines::Sparkline>,
    ) -> ooxml_types::sparklines::SparklineGroup {
        ooxml_types::sparklines::SparklineGroup {
            sparkline_type: self.sparkline_type,
            display_empty_cells_as: self.display_empty_cells_as,
            color_series: colors.color_series,
            color_negative: colors.color_negative,
            color_axis: colors.color_axis,
            color_markers: colors.color_markers,
            color_first: colors.color_first,
            color_last: colors.color_last,
            color_high: colors.color_high,
            color_low: colors.color_low,
            display_x_axis: self.display_x_axis,
            display_hidden: self.display_hidden,
            right_to_left: self.right_to_left,
            manual_max: self.manual_max,
            manual_min: self.manual_min,
            date_axis: if self.date_axis {
                Some(String::new())
            } else {
                None
            },
            markers: self.markers,
            high: self.high,
            low: self.low,
            first: self.first,
            last: self.last,
            negative: self.negative,
            line_weight: self.line_weight,
            min_axis_type: self.min_axis_type,
            max_axis_type: self.max_axis_type,
            sparklines,
        }
    }
}
