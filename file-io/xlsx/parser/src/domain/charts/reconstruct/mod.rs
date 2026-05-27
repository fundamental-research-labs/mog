//! Reconstruct ChartSpace from ChartSpec for XLSX export.
//!
//! This is the inverse of extraction: given ChartSpec typed fields,
//! build the ooxml_types::charts::ChartSpace that serializes to valid OOXML.
//!
//! Design principles:
//! - Fields from `ChartRoundTripData` (via `spec.rt`) restore non-API features losslessly.
//! - Fields from ChartSpec typed fields reconstruct API-visible content.
//! - When both exist, rt takes precedence for structural layout.
//! - `..Default::default()` is used extensively to avoid listing every optional field.

mod axes;
mod chart_groups;
mod chart_space;
mod formatting;
mod ranges;
mod series;

use axes::*;
use chart_groups::*;
use formatting::*;
use series::*;

use domain_types::chart::{
    AxisData, ChartColorData, ChartDashStyle, ChartDataTableData, ChartFillData, ChartFontData,
    ChartFormatData, ChartLineData, ChartSeriesData, ChartSpec, ChartStrikeStyle, ChartSubType,
    ChartType as DomainChartType, ChartUnderlineStyle, ChartView3DData, DataLabelData,
    ErrorBarData, LegendData, LegendEntryData, PointFormatData, SingleAxisData, TrendlineData,
    TrendlineLabelData,
};
use ooxml_types::charts::{
    self, AxisType, BarDirection, ChartAxis, ChartAxisPosition, ChartGroup, ChartLines, ChartSpace,
    ChartSurface, ChartText, ChartType as OoxmlChartType, ChartTypeConfig, CrossBetween,
    DataLabelOptions, DataLabelPosition, DataPointOverride, DataTableConfig, DisplayBlanksAs,
    ErrorBarDirection, ErrorBarType, ErrorBars, ErrorValueType, Grouping, LabelAlignment,
    LegendPosition, Marker, MarkerStyle, NumFmt, Orientation, Scaling, TickLabelPosition, TickMark,
    TimeUnit, Trendline, TrendlineLabel, TrendlineType, View3D,
};
use ooxml_types::charts::{CatDataSource, NumDataSource, NumRef, SeriesTextSource, StrRef};
use ooxml_types::drawings::{
    ColorTransform, DashStyle, DrawingColor, DrawingFill, GradientFill, GradientPathType,
    GradientStop, LineDash, LineFill, Outline, Paragraph, ParagraphProperties, PatternFill,
    PresetPatternVal, RunProperties, SchemeColor, ShapeProperties, SolidFill, StAngle,
    StPositiveFixedPercentageDecimal, TextBody, TextBodyProperties, TextFont, TextRun,
    TextRunContent, TextStrikeType, TextUnderlineType,
};

/// Reconstruct a ChartSpace from ChartSpec for XLSX export.
pub fn reconstruct_chart_space(spec: &ChartSpec) -> ChartSpace {
    chart_space::build_chart_space(spec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::charts::write_canonical::serialize_chart_space;
    use domain_types::chart::{AnchorPosition, ObjectSize};

    fn minimal_chart_spec(chart_type: DomainChartType, data_range: Option<&str>) -> ChartSpec {
        ChartSpec {
            chart_type,
            title: Some("Revenue".to_string()),
            position: AnchorPosition::default(),
            size: ObjectSize::default(),
            z_index: 0,
            definition: None,
            preserved_chart_xml: None,
            series: Vec::new(),
            sub_type: None,
            legend: None,
            axes: None,
            data_labels: None,
            data_range: data_range.map(str::to_string),
            style: None,
            rounded_corners: None,
            auto_title_deleted: None,
            show_data_labels_over_max: None,
            chart_format: None,
            plot_format: None,
            title_format: None,
            title_rich_text: None,
            title_formula: None,
            data_table: None,
            display_blanks_as: None,
            plot_visible_only: None,
            gap_width: None,
            overlap: None,
            doughnut_hole_size: None,
            first_slice_angle: None,
            bubble_scale: None,
            split_type: None,
            split_value: None,
            bar_shape: None,
            bubble_3d_effect: None,
            wireframe: None,
            surface_top_view: None,
            color_scheme: None,
            category_label_level: None,
            series_name_level: None,
            show_all_field_buttons: None,
            second_plot_size: None,
            vary_by_categories: None,
            title_h_align: None,
            title_v_align: None,
            title_show_shadow: None,
            pivot_options: None,
            view_3d: None,
            floor_format: None,
            side_wall_format: None,
            back_wall_format: None,
            rt: None,
            chart_frame: None,
            is_chart_ex: false,
            cnv_pr_name: None,
            cnv_pr_id: None,
            cnv_pr_descr: None,
            cnv_pr_title: None,
            cnv_pr_hidden: false,
            no_change_aspect: None,
            has_graphic_frame_locks: false,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            cnv_pr_ext_lst: None,
            anchor_edit_as: None,
            macro_name: None,
            client_data_locks_with_sheet: None,
            client_data_prints_with_sheet: None,
            anchor_index: None,
            import_status: None,
        }
    }

    #[test]
    fn data_range_chart_reconstructs_series_and_axes() {
        let spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:C4"));
        let xml = String::from_utf8(serialize_chart_space(&reconstruct_chart_space(&spec)))
            .expect("chart XML should be UTF-8");

        assert_eq!(xml.matches("<c:ser>").count(), 2);
        assert!(xml.contains("<c:cat>"));
        assert!(xml.contains("<c:f>Data!A2:A4</c:f>"));
        assert!(xml.contains("<c:f>Data!B2:B4</c:f>"));
        assert!(xml.contains("<c:f>Data!C2:C4</c:f>"));
        assert!(xml.contains("<c:catAx>"));
        assert!(xml.contains("<c:valAx>"));
        assert!(xml.contains("<c:crossAx val=\"222222222\"/>"));
        assert!(xml.contains("<c:crossAx val=\"111111111\"/>"));
    }

    #[test]
    fn explicit_series_keep_distinct_default_idx_order() {
        let mut spec = minimal_chart_spec(DomainChartType::Line, None);
        spec.series = vec![
            ranges::chart_series_data(
                None,
                Some("A2:A4".to_string()),
                Some("B2:B4".to_string()),
                0,
            ),
            ranges::chart_series_data(
                None,
                Some("A2:A4".to_string()),
                Some("C2:C4".to_string()),
                1,
            ),
        ];
        spec.series[0].idx = None;
        spec.series[0].order = None;
        spec.series[1].idx = None;
        spec.series[1].order = None;

        let xml = String::from_utf8(serialize_chart_space(&reconstruct_chart_space(&spec)))
            .expect("chart XML should be UTF-8");

        assert!(xml.contains("<c:idx val=\"0\"/>"));
        assert!(xml.contains("<c:idx val=\"1\"/>"));
        assert!(xml.contains("<c:order val=\"0\"/>"));
        assert!(xml.contains("<c:order val=\"1\"/>"));
    }

    #[test]
    fn scatter_data_range_uses_xy_axes_and_sources() {
        let spec = minimal_chart_spec(DomainChartType::Scatter, Some("'Sales Data'!A1:B4"));
        let xml = String::from_utf8(serialize_chart_space(&reconstruct_chart_space(&spec)))
            .expect("chart XML should be UTF-8");

        assert!(xml.contains("<c:scatterChart>"));
        assert!(xml.contains("<c:xVal>"));
        assert!(xml.contains("<c:yVal>"));
        assert!(!xml.contains("<c:cat>"));
        assert_eq!(xml.matches("<c:valAx>").count(), 2);
        assert!(xml.contains("<c:f>'Sales Data'!A2:A4</c:f>"));
        assert!(xml.contains("<c:f>'Sales Data'!B2:B4</c:f>"));
    }
}
