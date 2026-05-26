//! Chart type definitions for XLSX parsing
//!
//! Defines all chart types supported by OOXML (ECMA-376 Part 1, Section 21.2).
//!
//! Chart types include:
//! - Bar and Column charts (clustered, stacked, 100% stacked)
//! - Line charts (straight, smooth)
//! - Pie and Doughnut charts
//! - Area charts
//! - Scatter and Bubble charts
//! - Radar charts
//! - Surface charts
//! - Stock charts
//! - Combo charts

// =============================================================================
// Re-exports from ooxml-types
// =============================================================================

// These types are identical between xlsx-parser and ooxml-types.
// We re-export them from ooxml-types as the canonical definitions.
pub use ooxml_types::charts::{
    BarDirection, BarShape, ChartType, Grouping, MarkerStyle, RadarStyle, ScatterStyle, StockType,
};

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chart_type_from_element_name() {
        assert_eq!(ChartType::from_ooxml("barChart"), ChartType::Bar);
        assert_eq!(ChartType::from_ooxml("bar3DChart"), ChartType::Bar3D);
        assert_eq!(ChartType::from_ooxml("lineChart"), ChartType::Line);
        assert_eq!(ChartType::from_ooxml("pieChart"), ChartType::Pie);
        assert_eq!(ChartType::from_ooxml("doughnutChart"), ChartType::Doughnut);
        assert_eq!(ChartType::from_ooxml("scatterChart"), ChartType::Scatter);
        assert_eq!(ChartType::from_ooxml("bubbleChart"), ChartType::Bubble);
        assert_eq!(ChartType::from_ooxml("radarChart"), ChartType::Radar);
        assert_eq!(ChartType::from_ooxml("stockChart"), ChartType::Stock);
        assert_eq!(ChartType::from_ooxml("unknown"), ChartType::Unknown);
    }

    #[test]
    fn test_chart_type_to_element_name() {
        assert_eq!(ChartType::Bar.to_ooxml(), "barChart");
        assert_eq!(ChartType::Bar3D.to_ooxml(), "bar3DChart");
        assert_eq!(ChartType::Line.to_ooxml(), "lineChart");
        assert_eq!(ChartType::Pie.to_ooxml(), "pieChart");
        assert_eq!(ChartType::Scatter.to_ooxml(), "scatterChart");
    }

    #[test]
    fn test_chart_type_is_3d() {
        assert!(!ChartType::Bar.is_3d());
        assert!(ChartType::Bar3D.is_3d());
        assert!(!ChartType::Line.is_3d());
        assert!(ChartType::Line3D.is_3d());
        assert!(!ChartType::Pie.is_3d());
        assert!(ChartType::Pie3D.is_3d());
        assert!(ChartType::Surface3D.is_3d());
    }

    #[test]
    fn test_chart_type_uses_categories() {
        assert!(ChartType::Bar.uses_categories());
        assert!(ChartType::Line.uses_categories());
        assert!(ChartType::Pie.uses_categories());
        assert!(!ChartType::Scatter.uses_categories());
        assert!(!ChartType::Bubble.uses_categories());
    }

    #[test]
    fn test_chart_type_supports_multiple_series() {
        assert!(ChartType::Bar.supports_multiple_series());
        assert!(ChartType::Line.supports_multiple_series());
        assert!(!ChartType::Pie.supports_multiple_series());
        assert!(!ChartType::Pie3D.supports_multiple_series());
        assert!(!ChartType::Doughnut.supports_multiple_series());
    }

    #[test]
    fn test_bar_direction_from_ooxml() {
        assert_eq!(BarDirection::from_ooxml("bar"), BarDirection::Bar);
        assert_eq!(BarDirection::from_ooxml("col"), BarDirection::Column);
        assert_eq!(BarDirection::from_ooxml("unknown"), BarDirection::Column);
    }

    #[test]
    fn test_bar_direction_to_ooxml() {
        assert_eq!(BarDirection::Bar.to_ooxml(), "bar");
        assert_eq!(BarDirection::Column.to_ooxml(), "col");
    }

    #[test]
    fn test_grouping_from_ooxml() {
        assert_eq!(Grouping::from_ooxml("standard"), Grouping::Standard);
        assert_eq!(Grouping::from_ooxml("clustered"), Grouping::Clustered);
        assert_eq!(Grouping::from_ooxml("stacked"), Grouping::Stacked);
        assert_eq!(
            Grouping::from_ooxml("percentStacked"),
            Grouping::PercentStacked
        );
        assert_eq!(Grouping::from_ooxml("unknown"), Grouping::Standard);
    }

    #[test]
    fn test_grouping_to_ooxml() {
        assert_eq!(Grouping::Standard.to_ooxml(), "standard");
        assert_eq!(Grouping::Clustered.to_ooxml(), "clustered");
        assert_eq!(Grouping::Stacked.to_ooxml(), "stacked");
        assert_eq!(Grouping::PercentStacked.to_ooxml(), "percentStacked");
    }

    #[test]
    fn test_bar_shape_from_ooxml() {
        assert_eq!(BarShape::from_ooxml("box"), BarShape::Box);
        assert_eq!(BarShape::from_ooxml("cone"), BarShape::Cone);
        assert_eq!(BarShape::from_ooxml("cylinder"), BarShape::Cylinder);
        assert_eq!(BarShape::from_ooxml("pyramid"), BarShape::Pyramid);
        assert_eq!(BarShape::from_ooxml("unknown"), BarShape::Box);
    }

    #[test]
    fn test_marker_style_from_ooxml() {
        assert_eq!(MarkerStyle::from_ooxml("none"), MarkerStyle::None);
        assert_eq!(MarkerStyle::from_ooxml("auto"), MarkerStyle::Auto);
        assert_eq!(MarkerStyle::from_ooxml("circle"), MarkerStyle::Circle);
        assert_eq!(MarkerStyle::from_ooxml("diamond"), MarkerStyle::Diamond);
        assert_eq!(MarkerStyle::from_ooxml("square"), MarkerStyle::Square);
        assert_eq!(MarkerStyle::from_ooxml("triangle"), MarkerStyle::Triangle);
        assert_eq!(MarkerStyle::from_ooxml("unknown"), MarkerStyle::Auto);
    }

    #[test]
    fn test_marker_style_to_ooxml() {
        assert_eq!(MarkerStyle::None.to_ooxml(), "none");
        assert_eq!(MarkerStyle::Auto.to_ooxml(), "auto");
        assert_eq!(MarkerStyle::Circle.to_ooxml(), "circle");
        assert_eq!(MarkerStyle::Diamond.to_ooxml(), "diamond");
    }

    #[test]
    fn test_scatter_style_from_ooxml() {
        assert_eq!(ScatterStyle::from_ooxml("none"), ScatterStyle::None);
        assert_eq!(ScatterStyle::from_ooxml("line"), ScatterStyle::Line);
        assert_eq!(
            ScatterStyle::from_ooxml("lineMarker"),
            ScatterStyle::LineMarker
        );
        assert_eq!(ScatterStyle::from_ooxml("smooth"), ScatterStyle::Smooth);
        assert_eq!(
            ScatterStyle::from_ooxml("smoothMarker"),
            ScatterStyle::SmoothMarker
        );
        assert_eq!(ScatterStyle::from_ooxml("marker"), ScatterStyle::Marker);
        assert_eq!(ScatterStyle::from_ooxml("unknown"), ScatterStyle::Marker);
    }

    #[test]
    fn test_radar_style_from_ooxml() {
        assert_eq!(RadarStyle::from_ooxml("standard"), RadarStyle::Standard);
        assert_eq!(RadarStyle::from_ooxml("marker"), RadarStyle::Marker);
        assert_eq!(RadarStyle::from_ooxml("filled"), RadarStyle::Filled);
        assert_eq!(RadarStyle::from_ooxml("unknown"), RadarStyle::Standard);
    }

    #[test]
    fn test_chart_type_default() {
        assert_eq!(ChartType::default(), ChartType::Unknown);
    }

    #[test]
    fn test_bar_direction_default() {
        assert_eq!(BarDirection::default(), BarDirection::Column);
    }

    #[test]
    fn test_grouping_default() {
        assert_eq!(Grouping::default(), Grouping::Standard);
    }

    #[test]
    fn test_marker_style_default() {
        assert_eq!(MarkerStyle::default(), MarkerStyle::Auto);
    }
}
