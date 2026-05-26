use super::*;

// Helper: verify that every variant of an enum roundtrips through
// from_ooxml(to_ooxml()) == self.
macro_rules! assert_roundtrip {
    ($ty:ty, [$($variant:expr),+ $(,)?]) => {
        $(
            {
                let v: $ty = $variant;
                let serialized = v.to_ooxml();
                let deserialized = <$ty>::from_ooxml(serialized);
                assert_eq!(v, deserialized, "roundtrip failed for {:?}", v);
            }
        )+
    };
}

// --------------------------------------------------
// ChartType
// --------------------------------------------------

#[test]
fn chart_type_default() {
    assert_eq!(ChartType::default(), ChartType::Unknown);
}

#[test]
fn chart_type_roundtrip() {
    assert_roundtrip!(
        ChartType,
        [
            ChartType::Bar,
            ChartType::Bar3D,
            ChartType::Line,
            ChartType::Line3D,
            ChartType::Pie,
            ChartType::Pie3D,
            ChartType::Doughnut,
            ChartType::Area,
            ChartType::Area3D,
            ChartType::Scatter,
            ChartType::Bubble,
            ChartType::Radar,
            ChartType::Surface,
            ChartType::Surface3D,
            ChartType::Stock,
            ChartType::OfPie,
        ]
    );
    // Unknown and Combo have synthetic OOXML strings that don't parse back
    assert_eq!(ChartType::from_ooxml("unknownChart"), ChartType::Unknown);
    assert_eq!(ChartType::from_ooxml("comboChart"), ChartType::Unknown);
}

#[test]
fn chart_type_unknown_fallback() {
    assert_eq!(ChartType::from_ooxml("bogus"), ChartType::Unknown);
    assert_eq!(ChartType::from_ooxml(""), ChartType::Unknown);
}

#[test]
fn chart_type_is_3d() {
    assert!(ChartType::Bar3D.is_3d());
    assert!(ChartType::Line3D.is_3d());
    assert!(ChartType::Pie3D.is_3d());
    assert!(ChartType::Area3D.is_3d());
    assert!(ChartType::Surface3D.is_3d());
    assert!(!ChartType::Bar.is_3d());
    assert!(!ChartType::Line.is_3d());
    assert!(!ChartType::Scatter.is_3d());
    assert!(!ChartType::Combo.is_3d());
}

#[test]
fn chart_type_uses_categories() {
    assert!(ChartType::Bar.uses_categories());
    assert!(ChartType::Line.uses_categories());
    assert!(ChartType::Pie.uses_categories());
    assert!(!ChartType::Scatter.uses_categories());
    assert!(!ChartType::Bubble.uses_categories());
}

#[test]
fn chart_type_supports_multiple_series() {
    assert!(ChartType::Bar.supports_multiple_series());
    assert!(ChartType::Line.supports_multiple_series());
    assert!(ChartType::Scatter.supports_multiple_series());
    assert!(!ChartType::Pie.supports_multiple_series());
    assert!(!ChartType::Pie3D.supports_multiple_series());
    assert!(!ChartType::Doughnut.supports_multiple_series());
}

// --------------------------------------------------
// BarDirection
// --------------------------------------------------

#[test]
fn bar_direction_default() {
    assert_eq!(BarDirection::default(), BarDirection::Column);
}

#[test]
fn bar_direction_roundtrip() {
    assert_roundtrip!(BarDirection, [BarDirection::Bar, BarDirection::Column]);
}

#[test]
fn bar_direction_unknown_fallback() {
    assert_eq!(BarDirection::from_ooxml("bogus"), BarDirection::Column);
    assert_eq!(BarDirection::from_ooxml(""), BarDirection::Column);
}

// --------------------------------------------------
// Grouping
// --------------------------------------------------

#[test]
fn grouping_default() {
    assert_eq!(Grouping::default(), Grouping::Standard);
}

#[test]
fn grouping_roundtrip() {
    assert_roundtrip!(
        Grouping,
        [
            Grouping::Standard,
            Grouping::Clustered,
            Grouping::Stacked,
            Grouping::PercentStacked,
        ]
    );
}

#[test]
fn grouping_unknown_fallback() {
    assert_eq!(Grouping::from_ooxml("bogus"), Grouping::Standard);
    assert_eq!(Grouping::from_ooxml(""), Grouping::Standard);
}

// --------------------------------------------------
// BarShape
// --------------------------------------------------

#[test]
fn bar_shape_default() {
    assert_eq!(BarShape::default(), BarShape::Box);
}

#[test]
fn bar_shape_roundtrip() {
    assert_roundtrip!(
        BarShape,
        [
            BarShape::Box,
            BarShape::Cone,
            BarShape::ConeToMax,
            BarShape::Cylinder,
            BarShape::Pyramid,
            BarShape::PyramidToMax,
        ]
    );
}

#[test]
fn bar_shape_unknown_fallback() {
    assert_eq!(BarShape::from_ooxml("bogus"), BarShape::Box);
    assert_eq!(BarShape::from_ooxml(""), BarShape::Box);
}

// --------------------------------------------------
// MarkerStyle
// --------------------------------------------------

#[test]
fn marker_style_default() {
    assert_eq!(MarkerStyle::default(), MarkerStyle::Auto);
}

#[test]
fn marker_style_roundtrip() {
    assert_roundtrip!(
        MarkerStyle,
        [
            MarkerStyle::None,
            MarkerStyle::Auto,
            MarkerStyle::Circle,
            MarkerStyle::Dash,
            MarkerStyle::Diamond,
            MarkerStyle::Dot,
            MarkerStyle::Picture,
            MarkerStyle::Plus,
            MarkerStyle::Square,
            MarkerStyle::Star,
            MarkerStyle::Triangle,
            MarkerStyle::X,
        ]
    );
}

#[test]
fn marker_style_unknown_fallback() {
    assert_eq!(MarkerStyle::from_ooxml("bogus"), MarkerStyle::Auto);
    assert_eq!(MarkerStyle::from_ooxml(""), MarkerStyle::Auto);
}

// --------------------------------------------------
// ScatterStyle
// --------------------------------------------------

#[test]
fn scatter_style_default() {
    assert_eq!(ScatterStyle::default(), ScatterStyle::Marker);
}

#[test]
fn scatter_style_roundtrip() {
    assert_roundtrip!(
        ScatterStyle,
        [
            ScatterStyle::None,
            ScatterStyle::Line,
            ScatterStyle::LineMarker,
            ScatterStyle::Marker,
            ScatterStyle::Smooth,
            ScatterStyle::SmoothMarker,
        ]
    );
}

#[test]
fn scatter_style_unknown_fallback() {
    assert_eq!(ScatterStyle::from_ooxml("bogus"), ScatterStyle::Marker);
    assert_eq!(ScatterStyle::from_ooxml(""), ScatterStyle::Marker);
}

// --------------------------------------------------
// RadarStyle
// --------------------------------------------------

#[test]
fn radar_style_default() {
    assert_eq!(RadarStyle::default(), RadarStyle::Standard);
}

#[test]
fn radar_style_roundtrip() {
    assert_roundtrip!(
        RadarStyle,
        [RadarStyle::Standard, RadarStyle::Marker, RadarStyle::Filled,]
    );
}

#[test]
fn radar_style_unknown_fallback() {
    assert_eq!(RadarStyle::from_ooxml("bogus"), RadarStyle::Standard);
    assert_eq!(RadarStyle::from_ooxml(""), RadarStyle::Standard);
}

// --------------------------------------------------
// LegendPosition
// --------------------------------------------------

#[test]
fn legend_position_default() {
    assert_eq!(LegendPosition::default(), LegendPosition::Right);
}

#[test]
fn legend_position_roundtrip() {
    assert_roundtrip!(
        LegendPosition,
        [
            LegendPosition::Bottom,
            LegendPosition::Top,
            LegendPosition::Left,
            LegendPosition::Right,
            LegendPosition::TopRight,
        ]
    );
}

#[test]
fn legend_position_unknown_fallback() {
    assert_eq!(LegendPosition::from_ooxml("bogus"), LegendPosition::Right);
    assert_eq!(LegendPosition::from_ooxml(""), LegendPosition::Right);
}

// --------------------------------------------------
// DisplayBlanksAs
// --------------------------------------------------

#[test]
fn display_blanks_as_default() {
    assert_eq!(DisplayBlanksAs::default(), DisplayBlanksAs::Zero);
}

#[test]
fn display_blanks_as_roundtrip() {
    assert_roundtrip!(
        DisplayBlanksAs,
        [
            DisplayBlanksAs::Gap,
            DisplayBlanksAs::Span,
            DisplayBlanksAs::Zero,
        ]
    );
}

#[test]
fn display_blanks_as_unknown_fallback() {
    assert_eq!(DisplayBlanksAs::from_ooxml("bogus"), DisplayBlanksAs::Zero);
    assert_eq!(DisplayBlanksAs::from_ooxml(""), DisplayBlanksAs::Zero);
}

// --------------------------------------------------
// AxisType
// --------------------------------------------------

#[test]
fn axis_type_default() {
    assert_eq!(AxisType::default(), AxisType::Category);
}

#[test]
fn axis_type_roundtrip() {
    assert_roundtrip!(
        AxisType,
        [
            AxisType::Category,
            AxisType::Value,
            AxisType::Date,
            AxisType::Series,
        ]
    );
}

#[test]
fn axis_type_unknown_fallback() {
    assert_eq!(AxisType::from_ooxml("bogus"), AxisType::Category);
    assert_eq!(AxisType::from_ooxml(""), AxisType::Category);
}

// --------------------------------------------------
// AxisCrosses
// --------------------------------------------------

#[test]
fn axis_crosses_default() {
    assert_eq!(AxisCrosses::default(), AxisCrosses::AutoZero);
}

#[test]
fn axis_crosses_roundtrip() {
    assert_roundtrip!(
        AxisCrosses,
        [AxisCrosses::AutoZero, AxisCrosses::Min, AxisCrosses::Max,]
    );
}

#[test]
fn axis_crosses_unknown_fallback() {
    assert_eq!(AxisCrosses::from_ooxml("bogus"), AxisCrosses::AutoZero);
    assert_eq!(AxisCrosses::from_ooxml(""), AxisCrosses::AutoZero);
}

// --------------------------------------------------
// Orientation
// --------------------------------------------------

#[test]
fn orientation_default() {
    assert_eq!(Orientation::default(), Orientation::MinMax);
}

#[test]
fn orientation_roundtrip() {
    assert_roundtrip!(Orientation, [Orientation::MinMax, Orientation::MaxMin]);
}

#[test]
fn orientation_unknown_fallback() {
    assert_eq!(Orientation::from_ooxml("bogus"), Orientation::MinMax);
    assert_eq!(Orientation::from_ooxml(""), Orientation::MinMax);
}

// --------------------------------------------------
// TickMark
// --------------------------------------------------

#[test]
fn tick_mark_default() {
    assert_eq!(TickMark::default(), TickMark::Cross);
}

#[test]
fn tick_mark_roundtrip() {
    assert_roundtrip!(
        TickMark,
        [TickMark::Cross, TickMark::In, TickMark::None, TickMark::Out,]
    );
}

#[test]
fn tick_mark_unknown_fallback() {
    assert_eq!(TickMark::from_ooxml("bogus"), TickMark::Cross);
    assert_eq!(TickMark::from_ooxml(""), TickMark::Cross);
}

// --------------------------------------------------
// TickLabelPosition
// --------------------------------------------------

#[test]
fn tick_label_position_default() {
    assert_eq!(TickLabelPosition::default(), TickLabelPosition::NextTo);
}

#[test]
fn tick_label_position_roundtrip() {
    assert_roundtrip!(
        TickLabelPosition,
        [
            TickLabelPosition::High,
            TickLabelPosition::Low,
            TickLabelPosition::NextTo,
            TickLabelPosition::None,
        ]
    );
}

#[test]
fn tick_label_position_unknown_fallback() {
    assert_eq!(
        TickLabelPosition::from_ooxml("bogus"),
        TickLabelPosition::NextTo
    );
    assert_eq!(TickLabelPosition::from_ooxml(""), TickLabelPosition::NextTo);
}

// --------------------------------------------------
// LabelAlignment
// --------------------------------------------------

#[test]
fn label_alignment_default() {
    assert_eq!(LabelAlignment::default(), LabelAlignment::Center);
}

#[test]
fn label_alignment_roundtrip() {
    assert_roundtrip!(
        LabelAlignment,
        [
            LabelAlignment::Center,
            LabelAlignment::Left,
            LabelAlignment::Right,
        ]
    );
}

#[test]
fn label_alignment_unknown_fallback() {
    assert_eq!(LabelAlignment::from_ooxml("bogus"), LabelAlignment::Center);
    assert_eq!(LabelAlignment::from_ooxml(""), LabelAlignment::Center);
}

// --------------------------------------------------
// TimeUnit
// --------------------------------------------------

#[test]
fn time_unit_default() {
    assert_eq!(TimeUnit::default(), TimeUnit::Days);
}

#[test]
fn time_unit_roundtrip() {
    assert_roundtrip!(
        TimeUnit,
        [TimeUnit::Days, TimeUnit::Months, TimeUnit::Years]
    );
}

#[test]
fn time_unit_unknown_fallback() {
    assert_eq!(TimeUnit::from_ooxml("bogus"), TimeUnit::Days);
    assert_eq!(TimeUnit::from_ooxml(""), TimeUnit::Days);
}

// --------------------------------------------------
// DataLabelPosition
// --------------------------------------------------

#[test]
fn data_label_position_default() {
    assert_eq!(DataLabelPosition::default(), DataLabelPosition::BestFit);
}

#[test]
fn data_label_position_roundtrip() {
    assert_roundtrip!(
        DataLabelPosition,
        [
            DataLabelPosition::BestFit,
            DataLabelPosition::Bottom,
            DataLabelPosition::Center,
            DataLabelPosition::InsideBase,
            DataLabelPosition::InsideEnd,
            DataLabelPosition::Left,
            DataLabelPosition::OutsideEnd,
            DataLabelPosition::Right,
            DataLabelPosition::Top,
        ]
    );
}

#[test]
fn data_label_position_unknown_fallback() {
    assert_eq!(
        DataLabelPosition::from_ooxml("bogus"),
        DataLabelPosition::BestFit
    );
    assert_eq!(
        DataLabelPosition::from_ooxml(""),
        DataLabelPosition::BestFit
    );
}

// --------------------------------------------------
// ErrorBarDirection
// --------------------------------------------------

#[test]
fn error_bar_direction_default() {
    assert_eq!(ErrorBarDirection::default(), ErrorBarDirection::Y);
}

#[test]
fn error_bar_direction_roundtrip() {
    assert_roundtrip!(
        ErrorBarDirection,
        [ErrorBarDirection::X, ErrorBarDirection::Y]
    );
}

#[test]
fn error_bar_direction_unknown_fallback() {
    assert_eq!(ErrorBarDirection::from_ooxml("bogus"), ErrorBarDirection::Y);
    assert_eq!(ErrorBarDirection::from_ooxml(""), ErrorBarDirection::Y);
}

// --------------------------------------------------
// ErrorBarType
// --------------------------------------------------

#[test]
fn error_bar_type_default() {
    assert_eq!(ErrorBarType::default(), ErrorBarType::Both);
}

#[test]
fn error_bar_type_roundtrip() {
    assert_roundtrip!(
        ErrorBarType,
        [ErrorBarType::Both, ErrorBarType::Plus, ErrorBarType::Minus,]
    );
}

#[test]
fn error_bar_type_unknown_fallback() {
    assert_eq!(ErrorBarType::from_ooxml("bogus"), ErrorBarType::Both);
    assert_eq!(ErrorBarType::from_ooxml(""), ErrorBarType::Both);
}

// --------------------------------------------------
// ErrorValueType
// --------------------------------------------------

#[test]
fn error_value_type_default() {
    assert_eq!(ErrorValueType::default(), ErrorValueType::FixedVal);
}

#[test]
fn error_value_type_roundtrip() {
    assert_roundtrip!(
        ErrorValueType,
        [
            ErrorValueType::Custom,
            ErrorValueType::FixedVal,
            ErrorValueType::Percentage,
            ErrorValueType::StdDev,
            ErrorValueType::StdErr,
        ]
    );
}

#[test]
fn error_value_type_unknown_fallback() {
    assert_eq!(
        ErrorValueType::from_ooxml("bogus"),
        ErrorValueType::FixedVal
    );
    assert_eq!(ErrorValueType::from_ooxml(""), ErrorValueType::FixedVal);
}

// --------------------------------------------------
// TrendlineType
// --------------------------------------------------

#[test]
fn trendline_type_default() {
    assert_eq!(TrendlineType::default(), TrendlineType::Linear);
}

#[test]
fn trendline_type_roundtrip() {
    assert_roundtrip!(
        TrendlineType,
        [
            TrendlineType::Exponential,
            TrendlineType::Linear,
            TrendlineType::Logarithmic,
            TrendlineType::MovingAverage,
            TrendlineType::Polynomial,
            TrendlineType::Power,
        ]
    );
}

#[test]
fn trendline_type_unknown_fallback() {
    assert_eq!(TrendlineType::from_ooxml("bogus"), TrendlineType::Linear);
    assert_eq!(TrendlineType::from_ooxml(""), TrendlineType::Linear);
}

// --------------------------------------------------
// LayoutTarget
// --------------------------------------------------

#[test]
fn layout_target_default() {
    assert_eq!(LayoutTarget::default(), LayoutTarget::Outer);
}

#[test]
fn layout_target_roundtrip() {
    assert_roundtrip!(LayoutTarget, [LayoutTarget::Inner, LayoutTarget::Outer]);
}

#[test]
fn layout_target_unknown_fallback() {
    assert_eq!(LayoutTarget::from_ooxml("bogus"), LayoutTarget::Outer);
    assert_eq!(LayoutTarget::from_ooxml(""), LayoutTarget::Outer);
}

// --------------------------------------------------
// LayoutMode
// --------------------------------------------------

#[test]
fn layout_mode_default() {
    assert_eq!(LayoutMode::default(), LayoutMode::Factor);
}

#[test]
fn layout_mode_roundtrip() {
    assert_roundtrip!(LayoutMode, [LayoutMode::Edge, LayoutMode::Factor]);
}

#[test]
fn layout_mode_unknown_fallback() {
    assert_eq!(LayoutMode::from_ooxml("bogus"), LayoutMode::Factor);
    assert_eq!(LayoutMode::from_ooxml(""), LayoutMode::Factor);
}

// --------------------------------------------------
// AnchorType
// --------------------------------------------------

#[test]
fn anchor_type_default() {
    assert_eq!(AnchorType::default(), AnchorType::TwoCell);
}

#[test]
fn anchor_type_roundtrip() {
    assert_roundtrip!(
        AnchorType,
        [
            AnchorType::TwoCell,
            AnchorType::OneCell,
            AnchorType::Absolute,
        ]
    );
}

#[test]
fn anchor_type_unknown_fallback() {
    assert_eq!(AnchorType::from_ooxml("bogus"), AnchorType::TwoCell);
    assert_eq!(AnchorType::from_ooxml(""), AnchorType::TwoCell);
}

// --------------------------------------------------
// Structs -- Default impls
// --------------------------------------------------

#[test]
fn view_3d_default() {
    let v = View3D::default();
    assert_eq!(v.rot_x, None);
    assert_eq!(v.rot_y, None);
    assert_eq!(v.right_angle_axes, None);
    assert_eq!(v.perspective, None);
    assert_eq!(v.height_percent, None);
    assert_eq!(v.depth_percent, None);
}

#[test]
fn data_label_options_default() {
    let opts = DataLabelOptions::default();
    assert!(!opts.show_value);
    assert!(!opts.show_category);
    assert!(!opts.show_series_name);
    assert!(!opts.show_percent);
    assert!(!opts.show_legend_key);
    assert!(!opts.show_bubble_size);
    assert_eq!(opts.position, DataLabelPosition::BestFit);
    assert!(opts.separator.is_none());
    assert!(opts.num_fmt.is_none());
    assert!(opts.sp_pr.is_none());
    assert!(opts.tx_pr.is_none());
    assert!(opts.show_leader_lines.is_none());
    assert!(opts.leader_lines.is_none());
    assert!(opts.num_fmt_obj.is_none());
}

// --------------------------------------------------
// StockType (no OOXML string -- just default test)
// --------------------------------------------------

#[test]
fn stock_type_default() {
    assert_eq!(StockType::default(), StockType::HLC);
}

// --------------------------------------------------
// OfPieType
// --------------------------------------------------

#[test]
fn of_pie_type_default() {
    assert_eq!(OfPieType::default(), OfPieType::Pie);
}

#[test]
fn of_pie_type_roundtrip() {
    assert_roundtrip!(OfPieType, [OfPieType::Pie, OfPieType::Bar]);
}

#[test]
fn of_pie_type_unknown_fallback() {
    assert_eq!(OfPieType::from_ooxml("bogus"), OfPieType::Pie);
    assert_eq!(OfPieType::from_ooxml(""), OfPieType::Pie);
}

// --------------------------------------------------
// SplitType
// --------------------------------------------------

#[test]
fn split_type_default() {
    assert_eq!(SplitType::default(), SplitType::Auto);
}

#[test]
fn split_type_roundtrip() {
    assert_roundtrip!(
        SplitType,
        [
            SplitType::Auto,
            SplitType::Custom,
            SplitType::Percent,
            SplitType::Position,
            SplitType::Value,
        ]
    );
}

#[test]
fn split_type_unknown_fallback() {
    assert_eq!(SplitType::from_ooxml("bogus"), SplitType::Auto);
    assert_eq!(SplitType::from_ooxml(""), SplitType::Auto);
}

// --------------------------------------------------
// SizeRepresents
// --------------------------------------------------

#[test]
fn size_represents_default() {
    assert_eq!(SizeRepresents::default(), SizeRepresents::Area);
}

#[test]
fn size_represents_roundtrip() {
    assert_roundtrip!(
        SizeRepresents,
        [SizeRepresents::Area, SizeRepresents::Width]
    );
}

#[test]
fn size_represents_unknown_fallback() {
    assert_eq!(SizeRepresents::from_ooxml("bogus"), SizeRepresents::Area);
    assert_eq!(SizeRepresents::from_ooxml(""), SizeRepresents::Area);
}

// --------------------------------------------------
// CrossBetween
// --------------------------------------------------

#[test]
fn cross_between_default() {
    assert_eq!(CrossBetween::default(), CrossBetween::Between);
}

#[test]
fn cross_between_roundtrip() {
    assert_roundtrip!(CrossBetween, [CrossBetween::Between, CrossBetween::MidCat]);
}

#[test]
fn cross_between_unknown_fallback() {
    assert_eq!(CrossBetween::from_ooxml("bogus"), CrossBetween::Between);
    assert_eq!(CrossBetween::from_ooxml(""), CrossBetween::Between);
}

// --------------------------------------------------
// BuiltInUnit
// --------------------------------------------------

#[test]
fn built_in_unit_roundtrip() {
    assert_roundtrip!(
        BuiltInUnit,
        [
            BuiltInUnit::Hundreds,
            BuiltInUnit::Thousands,
            BuiltInUnit::TenThousands,
            BuiltInUnit::HundredThousands,
            BuiltInUnit::Millions,
            BuiltInUnit::TenMillions,
            BuiltInUnit::HundredMillions,
            BuiltInUnit::Billions,
            BuiltInUnit::Trillions,
        ]
    );
}

#[test]
fn built_in_unit_unknown_fallback() {
    assert_eq!(BuiltInUnit::from_ooxml("bogus"), BuiltInUnit::Thousands);
    assert_eq!(BuiltInUnit::from_ooxml(""), BuiltInUnit::Thousands);
}

// --------------------------------------------------
// PictureFormat
// --------------------------------------------------

#[test]
fn picture_format_default() {
    assert_eq!(PictureFormat::default(), PictureFormat::Stretch);
}

#[test]
fn picture_format_roundtrip() {
    assert_roundtrip!(
        PictureFormat,
        [
            PictureFormat::Stretch,
            PictureFormat::Stack,
            PictureFormat::StackScale,
        ]
    );
}

#[test]
fn picture_format_unknown_fallback() {
    assert_eq!(PictureFormat::from_ooxml("bogus"), PictureFormat::Stretch);
    assert_eq!(PictureFormat::from_ooxml(""), PictureFormat::Stretch);
}

// --------------------------------------------------
// ChartAxisPosition
// --------------------------------------------------

#[test]
fn chart_axis_position_default() {
    assert_eq!(ChartAxisPosition::default(), ChartAxisPosition::Bottom);
}

#[test]
fn chart_axis_position_roundtrip() {
    assert_roundtrip!(
        ChartAxisPosition,
        [
            ChartAxisPosition::Bottom,
            ChartAxisPosition::Top,
            ChartAxisPosition::Left,
            ChartAxisPosition::Right,
        ]
    );
}

#[test]
fn chart_axis_position_unknown_fallback() {
    assert_eq!(
        ChartAxisPosition::from_ooxml("bogus"),
        ChartAxisPosition::Bottom
    );
    assert_eq!(ChartAxisPosition::from_ooxml(""), ChartAxisPosition::Bottom);
}

#[test]
fn chart_axis_position_to_ooxml_values() {
    assert_eq!(ChartAxisPosition::Bottom.to_ooxml(), "b");
    assert_eq!(ChartAxisPosition::Top.to_ooxml(), "t");
    assert_eq!(ChartAxisPosition::Left.to_ooxml(), "l");
    assert_eq!(ChartAxisPosition::Right.to_ooxml(), "r");
}

// --------------------------------------------------
// TileFlipMode
// --------------------------------------------------

#[test]
fn tile_flip_mode_default() {
    assert_eq!(TileFlipMode::default(), TileFlipMode::None);
}

#[test]
fn tile_flip_mode_roundtrip() {
    assert_roundtrip!(
        TileFlipMode,
        [
            TileFlipMode::None,
            TileFlipMode::X,
            TileFlipMode::Y,
            TileFlipMode::XY,
        ]
    );
}

#[test]
fn tile_flip_mode_unknown_fallback() {
    assert_eq!(TileFlipMode::from_ooxml("bogus"), TileFlipMode::None);
    assert_eq!(TileFlipMode::from_ooxml(""), TileFlipMode::None);
}

// --------------------------------------------------
// ChartTypeConfig
// --------------------------------------------------

#[test]
fn chart_type_config_chart_type() {
    assert_eq!(
        ChartTypeConfig::Bar(BarChartConfig::default()).chart_type(),
        ChartType::Bar
    );
    assert_eq!(
        ChartTypeConfig::Bar3D(Bar3DChartConfig::default()).chart_type(),
        ChartType::Bar3D
    );
    assert_eq!(
        ChartTypeConfig::Line(LineChartConfig::default()).chart_type(),
        ChartType::Line
    );
    assert_eq!(
        ChartTypeConfig::Line3D(Line3DChartConfig::default()).chart_type(),
        ChartType::Line3D
    );
    assert_eq!(
        ChartTypeConfig::Pie(PieChartConfig::default()).chart_type(),
        ChartType::Pie
    );
    assert_eq!(
        ChartTypeConfig::Pie3D(Pie3DChartConfig::default()).chart_type(),
        ChartType::Pie3D
    );
    assert_eq!(
        ChartTypeConfig::Doughnut(DoughnutChartConfig::default()).chart_type(),
        ChartType::Doughnut
    );
    assert_eq!(
        ChartTypeConfig::Area(AreaChartConfig::default()).chart_type(),
        ChartType::Area
    );
    assert_eq!(
        ChartTypeConfig::Area3D(Area3DChartConfig::default()).chart_type(),
        ChartType::Area3D
    );
    assert_eq!(
        ChartTypeConfig::Scatter(ScatterChartConfig::default()).chart_type(),
        ChartType::Scatter
    );
    assert_eq!(
        ChartTypeConfig::Bubble(BubbleChartConfig::default()).chart_type(),
        ChartType::Bubble
    );
    assert_eq!(
        ChartTypeConfig::Radar(RadarChartConfig::default()).chart_type(),
        ChartType::Radar
    );
    assert_eq!(
        ChartTypeConfig::Surface(SurfaceChartConfig::default()).chart_type(),
        ChartType::Surface
    );
    assert_eq!(
        ChartTypeConfig::Surface3D(SurfaceChartConfig::default()).chart_type(),
        ChartType::Surface3D
    );
    assert_eq!(
        ChartTypeConfig::Stock(StockChartConfig::default()).chart_type(),
        ChartType::Stock
    );
    assert_eq!(
        ChartTypeConfig::OfPie(OfPieChartConfig::default()).chart_type(),
        ChartType::OfPie
    );
    assert_eq!(ChartTypeConfig::Combo.chart_type(), ChartType::Combo);
}

// --------------------------------------------------
// BubbleChartConfig default
// --------------------------------------------------

#[test]
fn bubble_chart_config_default() {
    let cfg = BubbleChartConfig::default();
    assert_eq!(cfg.bubble_scale, Some(100));
    assert!(cfg.vary_colors.is_none());
}

// --------------------------------------------------
// OfPieChartConfig default
// --------------------------------------------------

#[test]
fn of_pie_chart_config_default() {
    let cfg = OfPieChartConfig::default();
    assert_eq!(cfg.of_pie_type, OfPieType::Pie);
    assert_eq!(cfg.second_pie_size, Some(75));
    assert!(cfg.ser_lines.is_empty());
}

// --------------------------------------------------
// ChartProtection default
// --------------------------------------------------

#[test]
fn chart_protection_default() {
    let p = ChartProtection::default();
    assert_eq!(p.chart_object, None);
    assert_eq!(p.data, None);
    assert_eq!(p.formatting, None);
    assert_eq!(p.selection, None);
    assert_eq!(p.user_interface, None);
    // Effective values default to false
    assert!(!p.effective_chart_object());
    assert!(!p.effective_data());
    assert!(!p.effective_formatting());
    assert!(!p.effective_selection());
    assert!(!p.effective_user_interface());
}

// --------------------------------------------------
// PageMargins default
// --------------------------------------------------

#[test]
fn page_margins_default() {
    let m = PageMargins::default();
    assert!((m.left - 0.7).abs() < f64::EPSILON);
    assert!((m.right - 0.7).abs() < f64::EPSILON);
    assert!((m.top - 0.75).abs() < f64::EPSILON);
    assert!((m.bottom - 0.75).abs() < f64::EPSILON);
    assert!((m.header - 0.3).abs() < f64::EPSILON);
    assert!((m.footer - 0.3).abs() < f64::EPSILON);
}

// --------------------------------------------------
// NumFmt default
// --------------------------------------------------

#[test]
fn num_fmt_default() {
    let nf = NumFmt::default();
    assert!(nf.format_code.is_empty());
    assert_eq!(nf.source_linked, None);
}

// --------------------------------------------------
// Data source types
// --------------------------------------------------

#[test]
fn num_ref_default() {
    let nr = NumRef::default();
    assert!(nr.f.is_empty());
    assert!(nr.num_cache.is_none());
}

#[test]
fn str_ref_default() {
    let sr = StrRef::default();
    assert!(sr.f.is_empty());
    assert!(sr.str_cache.is_none());
}

#[test]
fn cat_data_source_serde_roundtrip() {
    let src = CatDataSource::StrRef(StrRef {
        f: "Sheet1!$A$1:$A$5".to_string(),
        str_cache: None,
        extensions: vec![],
    });
    let json = serde_json::to_string(&src).unwrap();
    let back: CatDataSource = serde_json::from_str(&json).unwrap();
    assert_eq!(src, back);
}

#[test]
fn series_text_source_serde_roundtrip() {
    let src = SeriesTextSource::Value("Revenue".to_string());
    let json = serde_json::to_string(&src).unwrap();
    let back: SeriesTextSource = serde_json::from_str(&json).unwrap();
    assert_eq!(src, back);
}

// --------------------------------------------------
// Series type
// --------------------------------------------------

#[test]
fn chart_series_default() {
    let s = ChartSeries::default();
    assert_eq!(s.idx, 0);
    assert_eq!(s.order, 0);
    assert!(s.tx.is_none());
    assert!(s.sp_pr.is_none());
    assert!(s.cat.is_none());
    assert!(s.val.is_none());
    assert!(s.trendline.is_empty());
    assert!(s.err_bars.is_empty());
}

#[test]
fn marker_default() {
    let m = Marker::default();
    assert!(m.symbol.is_none());
    assert!(m.size.is_none());
    assert!(m.sp_pr.is_none());
}

#[test]
fn error_bars_default() {
    let eb = ErrorBars::default();
    assert_eq!(eb.err_dir, None);
    assert_eq!(eb.err_bar_type, ErrorBarType::Both);
    assert_eq!(eb.err_val_type, ErrorValueType::FixedVal);
}

// --------------------------------------------------
// Axis type
// --------------------------------------------------

#[test]
fn chart_axis_default() {
    let a = ChartAxis::default();
    assert_eq!(a.axis_type, AxisType::Category);
    assert_eq!(a.ax_id, 0);
    assert!(!a.delete);
    assert_eq!(a.ax_pos, ChartAxisPosition::Bottom);
    assert_eq!(a.crosses, AxisCrosses::AutoZero);
}

#[test]
fn axis_position_roundtrip() {
    assert_roundtrip!(
        ChartAxisPosition,
        [
            ChartAxisPosition::Bottom,
            ChartAxisPosition::Top,
            ChartAxisPosition::Left,
            ChartAxisPosition::Right,
        ]
    );
}

#[test]
fn scaling_default() {
    let s = Scaling::default();
    assert_eq!(s.orientation, Orientation::MinMax);
    assert!(s.min.is_none());
    assert!(s.max.is_none());
    assert!(s.log_base.is_none());
}

// --------------------------------------------------
// Document model
// --------------------------------------------------

#[test]
fn chart_space_default() {
    let cs = ChartSpace::default();
    assert!(cs.date1904.is_none());
    assert!(cs.lang.is_none());
    assert!(cs.protection.is_none());
}

#[test]
fn chart_default() {
    let c = Chart::default();
    assert!(c.title.is_none());
    assert!(c.legend.is_none());
    assert!(c.view_3d.is_none());
}

#[test]
fn plot_area_default() {
    let pa = PlotArea::default();
    assert!(pa.layout.is_none());
    assert!(pa.chart_groups.is_empty());
    assert!(pa.axes.is_empty());
}

#[test]
fn chart_group_basic() {
    let cg = ChartGroup {
        chart_type: ChartType::Bar,
        config: ChartTypeConfig::Bar(BarChartConfig::default()),
        series: vec![],
        d_lbls: None,
        ax_id: vec![1, 2],
        raw_chart_type_attr: None,
    };
    assert_eq!(cg.chart_type, ChartType::Bar);
    assert_eq!(cg.ax_id, vec![1, 2]);
}

// --------------------------------------------------
// ChartText enum
// --------------------------------------------------

#[test]
fn chart_text_rich_variant() {
    use crate::drawings::TextBody;
    let ct = ChartText::Rich(TextBody::default());
    match &ct {
        ChartText::Rich(_tb) => {} // ok
        ChartText::StrRef(_) => panic!("expected Rich variant"),
    }
}

#[test]
fn chart_text_str_ref_variant() {
    let ct = ChartText::StrRef(StrRef {
        f: "Sheet1!$A$1".to_string(),
        str_cache: None,
        extensions: vec![],
    });
    match &ct {
        ChartText::StrRef(sr) => assert_eq!(sr.f, "Sheet1!$A$1"),
        ChartText::Rich(_) => panic!("expected StrRef variant"),
    }
}

#[test]
fn chart_text_serde_roundtrip() {
    let ct = ChartText::StrRef(StrRef {
        f: "Sheet1!$A$1".to_string(),
        str_cache: None,
        extensions: vec![],
    });
    let json = serde_json::to_string(&ct).unwrap();
    let back: ChartText = serde_json::from_str(&json).unwrap();
    assert_eq!(ct, back);
}

#[test]
fn title_text_is_chart_text_alias() {
    // TitleText is a type alias for ChartText
    let tt: TitleText = ChartText::StrRef(StrRef::default());
    let _ct: ChartText = tt; // should compile since they're the same type
}

#[test]
fn trendline_label_with_chart_text() {
    let label = TrendlineLabel {
        tx: Some(ChartText::StrRef(StrRef {
            f: "Sheet1!$B$1".to_string(),
            str_cache: None,
            extensions: vec![],
        })),
        ..Default::default()
    };
    assert!(label.tx.is_some());
}

// --------------------------------------------------
// MultiLvlStrData
// --------------------------------------------------

#[test]
fn multi_lvl_str_data_preserves_pt_count_and_levels() {
    let data = MultiLvlStrData {
        pt_count: Some(5),
        levels: vec![
            StrData {
                pt_count: Some(5),
                pts: vec![StrPoint {
                    idx: 0,
                    v: "A".to_string(),
                }],
                extensions: vec![],
            },
            StrData {
                pt_count: Some(5),
                pts: vec![StrPoint {
                    idx: 0,
                    v: "B".to_string(),
                }],
                extensions: vec![],
            },
        ],
        extensions: vec![],
    };
    assert_eq!(data.pt_count, Some(5));
    assert_eq!(data.effective_pt_count(), 5);
    assert_eq!(data.levels.len(), 2);
    assert_eq!(data.levels[0].pts[0].v, "A");
    assert_eq!(data.levels[1].pts[0].v, "B");
}

#[test]
fn multi_lvl_str_ref_uses_data_wrapper() {
    let mlsr = MultiLvlStrRef {
        f: "Sheet1!$A$1:$B$5".to_string(),
        multi_lvl_str_cache: Some(MultiLvlStrData {
            pt_count: Some(5),
            levels: vec![],
            extensions: vec![],
        }),
        extensions: vec![],
    };
    assert_eq!(mlsr.multi_lvl_str_cache.as_ref().unwrap().pt_count, Some(5));
}

// --------------------------------------------------
// ChartSeries.shape
// --------------------------------------------------

#[test]
fn chart_series_with_bar_shape() {
    let s = ChartSeries {
        shape: Some(BarShape::Cylinder),
        ..Default::default()
    };
    assert_eq!(s.shape, Some(BarShape::Cylinder));
}

#[test]
fn chart_series_shape_defaults_to_none() {
    let s = ChartSeries::default();
    assert!(s.shape.is_none());
}

// --------------------------------------------------
// DataLabel.num_fmt
// --------------------------------------------------

#[test]
fn data_label_with_num_fmt() {
    let label = DataLabel {
        idx: 0,
        num_fmt: Some(NumFmt {
            format_code: "0.00%".to_string(),
            source_linked: Some(false),
        }),
        ..Default::default()
    };
    assert_eq!(label.num_fmt.as_ref().unwrap().format_code, "0.00%");
    assert_eq!(label.num_fmt.as_ref().unwrap().source_linked, Some(false));
}

// --------------------------------------------------
// DataLabelOptions.delete + .d_lbl
// --------------------------------------------------

#[test]
fn data_label_options_with_delete() {
    let opts = DataLabelOptions {
        delete: Some(true),
        ..Default::default()
    };
    assert_eq!(opts.delete, Some(true));
}

#[test]
fn data_label_options_with_individual_overrides() {
    let opts = DataLabelOptions {
        d_lbl: vec![
            DataLabel {
                idx: 0,
                ..Default::default()
            },
            DataLabel {
                idx: 3,
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    assert_eq!(opts.d_lbl.len(), 2);
    assert_eq!(opts.d_lbl[0].idx, 0);
    assert_eq!(opts.d_lbl[1].idx, 3);
}

#[test]
fn data_label_options_default_has_no_delete_no_d_lbl() {
    let opts = DataLabelOptions::default();
    assert!(opts.delete.is_none());
    assert!(opts.d_lbl.is_empty());
}

// --------------------------------------------------
// PageOrientation + PageSetup
// --------------------------------------------------

#[test]
fn page_orientation_roundtrip() {
    assert_roundtrip!(
        PageOrientation,
        [
            PageOrientation::Default,
            PageOrientation::Portrait,
            PageOrientation::Landscape,
        ]
    );
}

#[test]
fn page_orientation_unknown_fallback() {
    assert_eq!(
        PageOrientation::from_ooxml("bogus"),
        PageOrientation::Default
    );
    assert_eq!(PageOrientation::from_ooxml(""), PageOrientation::Default);
}

#[test]
fn page_setup_all_fields() {
    let ps = PageSetup {
        paper_size: Some(1),
        paper_height: Some("297mm".to_string()),
        paper_width: Some("210mm".to_string()),
        first_page_number: Some(1),
        orientation: Some(PageOrientation::Landscape),
        black_and_white: Some(false),
        draft: Some(true),
        use_first_page_number: Some(true),
        horizontal_dpi: Some(600),
        vertical_dpi: Some(600),
        copies: Some(2),
    };
    assert_eq!(ps.paper_size, Some(1));
    assert_eq!(ps.orientation, Some(PageOrientation::Landscape));
    assert_eq!(ps.horizontal_dpi, Some(600));
    assert_eq!(ps.copies, Some(2));
}

// --------------------------------------------------
// DisplayUnitKind + DisplayUnits
// --------------------------------------------------

#[test]
fn display_unit_kind_built_in() {
    let du = DisplayUnits {
        kind: Some(DisplayUnitKind::BuiltIn(BuiltInUnit::Millions)),
        disp_units_lbl: None,
        ..Default::default()
    };
    match du.kind {
        Some(DisplayUnitKind::BuiltIn(BuiltInUnit::Millions)) => {} // ok
        _ => panic!("expected BuiltIn(Millions)"),
    }
}

#[test]
fn display_unit_kind_custom() {
    let du = DisplayUnits {
        kind: Some(DisplayUnitKind::Custom(1000.0)),
        disp_units_lbl: None,
        ..Default::default()
    };
    match du.kind {
        Some(DisplayUnitKind::Custom(v)) => assert!((v - 1000.0).abs() < f64::EPSILON),
        _ => panic!("expected Custom(1000.0)"),
    }
}

#[test]
fn display_units_default_has_no_kind() {
    let du = DisplayUnits::default();
    assert!(du.kind.is_none());
    assert!(du.disp_units_lbl.is_none());
}

// --------------------------------------------------
// LegendEntry mutual exclusivity
// --------------------------------------------------

#[test]
fn legend_entry_mutual_exclusivity() {
    // Valid: delete only
    let entry_delete = LegendEntry {
        idx: 0,
        delete: Some(true),
        tx_pr: None,
        extensions: vec![],
    };
    #[cfg(debug_assertions)]
    assert!(entry_delete.is_valid());
    let _ = entry_delete;

    // Valid: tx_pr only
    use crate::drawings::TextBody;
    let entry_styled = LegendEntry {
        idx: 0,
        delete: None,
        tx_pr: Some(TextBody::default()),
        extensions: vec![],
    };
    #[cfg(debug_assertions)]
    assert!(entry_styled.is_valid());
    let _ = entry_styled;

    // Invalid: both set
    let entry_invalid = LegendEntry {
        idx: 0,
        delete: Some(true),
        tx_pr: Some(TextBody::default()),
        extensions: vec![],
    };
    #[cfg(debug_assertions)]
    assert!(!entry_invalid.is_valid());
    let _ = entry_invalid;
}

// --------------------------------------------------
// Bar3DChartConfig no overlap
// --------------------------------------------------

#[test]
fn bar_3d_chart_config_no_overlap() {
    // Bar3DChartConfig should NOT have overlap or ser_lines fields
    // (removed per ECMA-376: CT_Bar3DChart does not include these)
    let cfg = Bar3DChartConfig::default();
    // Just verify it has the correct fields and defaults
    assert_eq!(cfg.bar_dir, BarDirection::Column);
    assert!(cfg.grouping.is_none());
    assert!(cfg.vary_colors.is_none());
    assert!(cfg.gap_width.is_none());
    assert!(cfg.gap_depth.is_none());
    assert!(cfg.shape.is_none());
}
