use domain_types::{
    ChartDefinition,
    chart::{
        ChartLineSettingsData, ChartSpec, ChartSubType, ChartType as DomainChartType,
        UpDownBarsData,
    },
};
use ooxml_types::charts::{
    self, BarDirection, ChartGroup, ChartType as OoxmlChartType, ChartTypeConfig, Grouping,
};

use super::{
    elements::build_data_labels,
    formatting::{build_outline, build_shape_properties},
    ranges::series_for_export,
    series::build_series,
};

// =============================================================================
// Chart Groups
// =============================================================================

pub(super) fn build_chart_groups(spec: &ChartSpec) -> Vec<ChartGroup> {
    if let Some(ChartDefinition::Chart(chart_space)) = spec.definition.as_ref() {
        if !chart_space.chart.plot_area.chart_groups.is_empty() {
            return chart_space
                .chart
                .plot_area
                .chart_groups
                .iter()
                .map(|group| {
                    let series: Vec<_> = group
                        .series
                        .iter()
                        .map(|series| series.idx)
                        .filter_map(|idx| spec.series.iter().find(|s| s.idx == Some(idx)))
                        .enumerate()
                        .map(|(fallback_idx, sd)| {
                            build_series(sd, &spec.chart_type, fallback_idx as u32)
                        })
                        .collect();

                    // Inject series into the config template. The template is
                    // stored as a domain `ChartTypeConfig`; convert back to
                    // the ooxml form for the writer helpers to consume.
                    let config = inject_series_into_config(&group.config, &series, spec);

                    // Inject chart-level data labels
                    let d_lbls = spec.data_labels.as_ref().map(build_data_labels);

                    // Chart-type discriminant. `ChartType::Unknown(s)`
                    // (from a non-standard @chartType attribute) round-trips
                    // as the raw attribute on `ChartGroup`; everything else
                    // maps to the OOXML enum (row 2.13 + 2.21 fold).
                    ChartGroup {
                        chart_type: group.chart_type,
                        config,
                        series,
                        d_lbls,
                        ax_id: group.ax_id.clone(),
                        raw_chart_type_attr: group.raw_chart_type_attr.clone(),
                        raw_chart_element_name: group.raw_chart_element_name.clone(),
                        raw_chart_group_xml: group.raw_chart_group_xml.clone(),
                    }
                })
                .collect();
        }
    }

    // Fallback: build a single chart group from spec.chart_type + all series
    let ooxml_ct = domain_to_ooxml_chart_type(&spec.chart_type, spec.sub_type.as_ref());
    let series_data = series_for_export(spec);
    let series: Vec<_> = series_data
        .iter()
        .enumerate()
        .map(|(fallback_idx, sd)| build_series(sd, &spec.chart_type, fallback_idx as u32))
        .collect();
    let config = build_default_config(ooxml_ct, spec, &series);
    let d_lbls = spec.data_labels.as_ref().map(build_data_labels);

    // Determine default axis IDs based on chart type
    let ax_id = default_axis_ids(ooxml_ct);

    vec![ChartGroup {
        chart_type: ooxml_ct,
        config,
        series,
        d_lbls,
        ax_id,
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }]
}

pub(super) fn domain_to_ooxml_chart_type(
    ct: &DomainChartType,
    _sub_type: Option<&ChartSubType>,
) -> OoxmlChartType {
    ct.to_ooxml()
}

/// Map domain sub-type to OOXML Grouping.
pub(super) fn sub_type_to_grouping(sub: Option<&ChartSubType>) -> Grouping {
    match sub {
        Some(ChartSubType::Clustered) => Grouping::Clustered,
        Some(ChartSubType::Stacked) => Grouping::Stacked,
        Some(ChartSubType::PercentStacked) => Grouping::PercentStacked,
        _ => Grouping::Clustered,
    }
}

/// Determine bar direction from domain chart type.
pub(super) fn bar_direction_for(ct: &DomainChartType) -> BarDirection {
    match ct {
        DomainChartType::Bar | DomainChartType::Bar3D => BarDirection::Bar,
        _ => BarDirection::Column,
    }
}

/// Default axis IDs based on chart type.
pub(super) fn default_axis_ids(ct: OoxmlChartType) -> Vec<u32> {
    match ct {
        OoxmlChartType::Pie | OoxmlChartType::Pie3D | OoxmlChartType::Doughnut => vec![],
        _ => vec![111111111, 222222222],
    }
}

/// Build a default ChartTypeConfig for a single-group chart.
pub(super) fn build_default_config(
    ct: OoxmlChartType,
    spec: &ChartSpec,
    _series: &[charts::ChartSeries],
) -> ChartTypeConfig {
    let grouping = sub_type_to_grouping(spec.sub_type.as_ref());
    match ct {
        OoxmlChartType::Bar => {
            let bar_dir = bar_direction_for(&spec.chart_type);
            ChartTypeConfig::Bar(charts::BarChartConfig {
                bar_dir,
                grouping: Some(grouping),
                gap_width: spec.gap_width,
                overlap: spec.overlap,
                ser_lines: spec
                    .series_lines
                    .as_ref()
                    .map(build_chart_lines_vec)
                    .unwrap_or_default(),
                ..Default::default()
            })
        }
        OoxmlChartType::Bar3D => {
            let bar_dir = bar_direction_for(&spec.chart_type);
            ChartTypeConfig::Bar3D(charts::Bar3DChartConfig {
                bar_dir,
                grouping: Some(grouping),
                gap_width: spec.gap_width,
                gap_depth: spec.gap_depth,
                shape: spec.bar_shape.as_deref().map(charts::BarShape::from_ooxml),
                ..Default::default()
            })
        }
        OoxmlChartType::Line => ChartTypeConfig::Line(charts::LineChartConfig {
            grouping,
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            hi_low_lines: spec.high_low_lines.as_ref().map(build_chart_lines),
            up_down_bars: spec.up_down_bars.as_ref().map(build_up_down_bars),
            ..Default::default()
        }),
        OoxmlChartType::Line3D => ChartTypeConfig::Line3D(charts::Line3DChartConfig {
            grouping,
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            gap_depth: spec.gap_depth,
            ..Default::default()
        }),
        OoxmlChartType::Pie => ChartTypeConfig::Pie(charts::PieChartConfig {
            first_slice_ang: spec.first_slice_angle,
            ..Default::default()
        }),
        OoxmlChartType::Pie3D => ChartTypeConfig::Pie3D(charts::Pie3DChartConfig::default()),
        OoxmlChartType::Doughnut => ChartTypeConfig::Doughnut(charts::DoughnutChartConfig {
            hole_size: spec.doughnut_hole_size,
            first_slice_ang: spec.first_slice_angle,
            ..Default::default()
        }),
        OoxmlChartType::Area => ChartTypeConfig::Area(charts::AreaChartConfig {
            grouping: Some(grouping),
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            ..Default::default()
        }),
        OoxmlChartType::Area3D => ChartTypeConfig::Area3D(charts::Area3DChartConfig {
            grouping: Some(grouping),
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            gap_depth: spec.gap_depth,
            ..Default::default()
        }),
        OoxmlChartType::Scatter => ChartTypeConfig::Scatter(charts::ScatterChartConfig::default()),
        OoxmlChartType::Bubble => ChartTypeConfig::Bubble(charts::BubbleChartConfig {
            bubble_scale: spec.bubble_scale,
            show_neg_bubbles: spec.show_neg_bubbles,
            size_represents: spec
                .size_represents
                .as_deref()
                .map(charts::SizeRepresents::from_ooxml),
            bubble_3d: spec.bubble_3d_effect,
            ..Default::default()
        }),
        OoxmlChartType::Radar => ChartTypeConfig::Radar(charts::RadarChartConfig::default()),
        OoxmlChartType::Surface => ChartTypeConfig::Surface(charts::SurfaceChartConfig {
            wireframe: spec.wireframe,
            ..Default::default()
        }),
        OoxmlChartType::Surface3D => ChartTypeConfig::Surface3D(charts::SurfaceChartConfig {
            wireframe: spec.wireframe,
            ..Default::default()
        }),
        OoxmlChartType::Stock => ChartTypeConfig::Stock(charts::StockChartConfig {
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            hi_low_lines: spec.high_low_lines.as_ref().map(build_chart_lines),
            up_down_bars: spec.up_down_bars.as_ref().map(build_up_down_bars),
            ..Default::default()
        }),
        OoxmlChartType::OfPie => ChartTypeConfig::OfPie(charts::OfPieChartConfig {
            split_type: spec
                .split_type
                .as_deref()
                .map(charts::SplitType::from_ooxml),
            split_pos: spec.split_value,
            gap_width: spec.gap_width,
            ser_lines: spec
                .series_lines
                .as_ref()
                .map(build_chart_lines_vec)
                .unwrap_or_default(),
            ..Default::default()
        }),
        _ => ChartTypeConfig::Bar(charts::BarChartConfig::default()),
    }
}

/// Inject series into a config template (from round-trip metadata).
/// The config_template stores non-series fields; we overlay series + spec-level values.
pub(super) fn inject_series_into_config(
    template: &ChartTypeConfig,
    _series: &[charts::ChartSeries],
    spec: &ChartSpec,
) -> ChartTypeConfig {
    match template {
        ChartTypeConfig::Bar(c) => ChartTypeConfig::Bar(charts::BarChartConfig {
            gap_width: spec.gap_width.or(c.gap_width),
            overlap: spec.overlap.or(c.overlap),
            ser_lines: spec
                .series_lines
                .as_ref()
                .map(build_chart_lines_vec)
                .unwrap_or_else(|| c.ser_lines.clone()),
            ..c.clone()
        }),
        ChartTypeConfig::Bar3D(c) => ChartTypeConfig::Bar3D(charts::Bar3DChartConfig {
            gap_width: spec.gap_width.or(c.gap_width),
            gap_depth: spec.gap_depth.or(c.gap_depth),
            shape: spec
                .bar_shape
                .as_deref()
                .map(charts::BarShape::from_ooxml)
                .or(c.shape),
            ..c.clone()
        }),
        ChartTypeConfig::Line(c) => ChartTypeConfig::Line(charts::LineChartConfig {
            drop_lines: spec
                .drop_lines
                .as_ref()
                .map(build_chart_lines)
                .or_else(|| c.drop_lines.clone()),
            hi_low_lines: spec
                .high_low_lines
                .as_ref()
                .map(build_chart_lines)
                .or_else(|| c.hi_low_lines.clone()),
            up_down_bars: spec
                .up_down_bars
                .as_ref()
                .map(build_up_down_bars)
                .or_else(|| c.up_down_bars.clone()),
            ..c.clone()
        }),
        ChartTypeConfig::Line3D(c) => ChartTypeConfig::Line3D(charts::Line3DChartConfig {
            drop_lines: spec
                .drop_lines
                .as_ref()
                .map(build_chart_lines)
                .or_else(|| c.drop_lines.clone()),
            gap_depth: spec.gap_depth.or(c.gap_depth),
            ..c.clone()
        }),
        ChartTypeConfig::Pie(c) => ChartTypeConfig::Pie(charts::PieChartConfig {
            first_slice_ang: spec.first_slice_angle.or(c.first_slice_ang),
            ..c.clone()
        }),
        ChartTypeConfig::Pie3D(c) => ChartTypeConfig::Pie3D(c.clone()),
        ChartTypeConfig::Doughnut(c) => ChartTypeConfig::Doughnut(charts::DoughnutChartConfig {
            hole_size: spec.doughnut_hole_size.or(c.hole_size),
            first_slice_ang: spec.first_slice_angle.or(c.first_slice_ang),
            ..c.clone()
        }),
        ChartTypeConfig::Area(c) => ChartTypeConfig::Area(charts::AreaChartConfig {
            drop_lines: spec
                .drop_lines
                .as_ref()
                .map(build_chart_lines)
                .or_else(|| c.drop_lines.clone()),
            ..c.clone()
        }),
        ChartTypeConfig::Area3D(c) => ChartTypeConfig::Area3D(charts::Area3DChartConfig {
            drop_lines: spec
                .drop_lines
                .as_ref()
                .map(build_chart_lines)
                .or_else(|| c.drop_lines.clone()),
            gap_depth: spec.gap_depth.or(c.gap_depth),
            ..c.clone()
        }),
        ChartTypeConfig::Scatter(c) => ChartTypeConfig::Scatter(c.clone()),
        ChartTypeConfig::Bubble(c) => ChartTypeConfig::Bubble(charts::BubbleChartConfig {
            bubble_scale: spec.bubble_scale.or(c.bubble_scale),
            show_neg_bubbles: spec.show_neg_bubbles.or(c.show_neg_bubbles),
            size_represents: spec
                .size_represents
                .as_deref()
                .map(charts::SizeRepresents::from_ooxml)
                .or(c.size_represents),
            bubble_3d: spec.bubble_3d_effect.or(c.bubble_3d),
            ..c.clone()
        }),
        ChartTypeConfig::Radar(c) => ChartTypeConfig::Radar(c.clone()),
        ChartTypeConfig::Surface(c) => ChartTypeConfig::Surface(charts::SurfaceChartConfig {
            wireframe: spec.wireframe.or(c.wireframe),
            ..c.clone()
        }),
        ChartTypeConfig::Surface3D(c) => ChartTypeConfig::Surface3D(charts::SurfaceChartConfig {
            wireframe: spec.wireframe.or(c.wireframe),
            ..c.clone()
        }),
        ChartTypeConfig::Stock(c) => ChartTypeConfig::Stock(charts::StockChartConfig {
            drop_lines: spec
                .drop_lines
                .as_ref()
                .map(build_chart_lines)
                .or_else(|| c.drop_lines.clone()),
            hi_low_lines: spec
                .high_low_lines
                .as_ref()
                .map(build_chart_lines)
                .or_else(|| c.hi_low_lines.clone()),
            up_down_bars: spec
                .up_down_bars
                .as_ref()
                .map(build_up_down_bars)
                .or_else(|| c.up_down_bars.clone()),
            ..c.clone()
        }),
        ChartTypeConfig::OfPie(c) => ChartTypeConfig::OfPie(charts::OfPieChartConfig {
            split_type: spec
                .split_type
                .as_deref()
                .map(charts::SplitType::from_ooxml)
                .or(c.split_type),
            split_pos: spec.split_value.or(c.split_pos),
            gap_width: spec.gap_width.or(c.gap_width),
            ser_lines: spec
                .series_lines
                .as_ref()
                .map(build_chart_lines_vec)
                .unwrap_or_else(|| c.ser_lines.clone()),
            ..c.clone()
        }),
        ChartTypeConfig::Combo => ChartTypeConfig::Combo,
    }
}

fn build_chart_lines(settings: &ChartLineSettingsData) -> charts::ChartLines {
    charts::ChartLines {
        sp_pr: settings
            .format
            .as_ref()
            .map(|line| charts::ShapeProperties {
                ln: Some(build_outline(line)),
                ..Default::default()
            }),
    }
}

fn build_chart_lines_vec(settings: &ChartLineSettingsData) -> Vec<charts::ChartLines> {
    if settings.visible == Some(false) {
        Vec::new()
    } else {
        vec![build_chart_lines(settings)]
    }
}

fn build_up_down_bars(settings: &UpDownBarsData) -> charts::UpDownBars {
    charts::UpDownBars {
        gap_width: settings.gap_width,
        up_bars: settings.up_format.as_ref().and_then(build_shape_properties),
        down_bars: settings
            .down_format
            .as_ref()
            .and_then(build_shape_properties),
        ..Default::default()
    }
}
