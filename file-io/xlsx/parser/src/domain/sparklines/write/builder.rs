//! Ergonomic builder for canonical sparkline groups.

use ooxml_types::sparklines::{
    DisplayEmptyCellsAs, Sparkline, SparklineAxisType, SparklineColor, SparklineGroup,
    SparklineType,
};

/// Builder for constructing a `SparklineGroup` with a fluent API.
///
/// # Example
///
/// ```ignore
/// let mut group = SparklineGroupBuilder::new(SparklineType::Line);
/// group
///     .add("Sheet1!A1:A10", "B1")
///     .add("Sheet1!A2:A11", "B2")
///     .show_markers(true)
///     .show_high_point(true)
///     .color("FF376092")
///     .high_color("FFD00000");
/// let sparkline_group = group.build();
/// ```
pub struct SparklineGroupBuilder {
    inner: SparklineGroup,
}

impl SparklineGroupBuilder {
    /// Create a new builder with the specified sparkline type.
    pub fn new(sparkline_type: SparklineType) -> Self {
        let mut inner = SparklineGroup::default();
        inner.sparkline_type = sparkline_type;
        Self { inner }
    }

    /// Consume the builder and return the built `SparklineGroup`.
    pub fn build(self) -> SparklineGroup {
        self.inner
    }

    /// Add a sparkline to the group.
    pub fn add(&mut self, data_range: &str, location: &str) -> &mut Self {
        self.inner
            .sparklines
            .push(Sparkline::new(data_range, location));
        self
    }

    /// Set line weight (for line sparklines).
    pub fn line_weight(&mut self, weight: f64) -> &mut Self {
        self.inner.line_weight = Some(weight);
        self
    }

    /// Show markers on line sparklines.
    pub fn show_markers(&mut self, show: bool) -> &mut Self {
        self.inner.markers = show;
        self
    }

    /// Highlight high point.
    pub fn show_high_point(&mut self, show: bool) -> &mut Self {
        self.inner.high = show;
        self
    }

    /// Highlight low point.
    pub fn show_low_point(&mut self, show: bool) -> &mut Self {
        self.inner.low = show;
        self
    }

    /// Highlight first point.
    pub fn show_first_point(&mut self, show: bool) -> &mut Self {
        self.inner.first = show;
        self
    }

    /// Highlight last point.
    pub fn show_last_point(&mut self, show: bool) -> &mut Self {
        self.inner.last = show;
        self
    }

    /// Highlight negative points.
    pub fn show_negative_points(&mut self, show: bool) -> &mut Self {
        self.inner.negative = show;
        self
    }

    /// Show X axis.
    pub fn show_x_axis(&mut self, show: bool) -> &mut Self {
        self.inner.display_x_axis = show;
        self
    }

    /// Set how empty cells are displayed.
    pub fn display_empty_cells_as(&mut self, mode: DisplayEmptyCellsAs) -> &mut Self {
        self.inner.display_empty_cells_as = mode;
        self
    }

    /// Include hidden cells in data.
    pub fn show_hidden(&mut self, show: bool) -> &mut Self {
        self.inner.display_hidden = show;
        self
    }

    /// Set right-to-left display.
    pub fn right_to_left(&mut self, rtl: bool) -> &mut Self {
        self.inner.right_to_left = rtl;
        self
    }

    /// Set series color (main sparkline color).
    pub fn color(&mut self, color: &str) -> &mut Self {
        self.inner.color_series = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set negative color.
    pub fn negative_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_negative = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set axis color.
    pub fn axis_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_axis = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set marker color.
    pub fn marker_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_markers = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set first point color.
    pub fn first_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_first = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set last point color.
    pub fn last_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_last = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set high point color.
    pub fn high_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_high = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set low point color.
    pub fn low_color(&mut self, color: &str) -> &mut Self {
        self.inner.color_low = Some(SparklineColor::from_rgb(color));
        self
    }

    /// Set axis min/max range.
    ///
    /// This sets both min and max axis types to Custom and sets the manual values.
    pub fn set_axis_range(&mut self, min: f64, max: f64) -> &mut Self {
        self.inner.min_axis_type = SparklineAxisType::Custom;
        self.inner.max_axis_type = SparklineAxisType::Custom;
        self.inner.manual_min = Some(min);
        self.inner.manual_max = Some(max);
        self
    }

    /// Set minimum axis type.
    pub fn min_axis_type(&mut self, axis_type: SparklineAxisType) -> &mut Self {
        self.inner.min_axis_type = axis_type;
        self
    }

    /// Set maximum axis type.
    pub fn max_axis_type(&mut self, axis_type: SparklineAxisType) -> &mut Self {
        self.inner.max_axis_type = axis_type;
        self
    }

    /// Set date axis range reference.
    pub fn date_axis(&mut self, range: &str) -> &mut Self {
        self.inner.date_axis = Some(range.to_string());
        self
    }
}
