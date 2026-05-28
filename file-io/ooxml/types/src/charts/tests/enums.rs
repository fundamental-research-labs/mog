use crate::charts::*;

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
fn stock_type_default() {
    assert_eq!(StockType::default(), StockType::HLC);
}

// --------------------------------------------------
// OfPieType
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
