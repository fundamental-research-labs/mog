use domain_types::{
    ChartDefinition,
    chart::{
        ChartLineSettingsData, ChartSeriesData, ChartSeriesStockRoleData, ChartSpec, ChartSubType,
        ChartType as DomainChartType, UpDownBarsData,
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
            let chart_groups: Vec<_> = chart_space
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
                            build_series(sd, &spec.chart_type, fallback_idx as u32, false)
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
            if chart_groups.iter().all(|group| !group.series.is_empty())
                || series_for_export(spec).is_empty()
            {
                return chart_groups;
            }
        }
    }

    let series_data = series_for_export(spec);
    if let Some(groups) = build_modeled_combo_chart_groups(spec, &series_data) {
        return groups;
    }

    if let Some(group) = build_modeled_stock_role_chart_group(spec, &series_data) {
        return vec![group];
    }

    // Fallback: build a single chart group from spec.chart_type + all series.
    vec![build_modeled_chart_group(
        spec,
        &spec.chart_type,
        series_data.iter().enumerate().collect(),
    )]
}

#[derive(Debug)]
struct ModeledSeriesGroup<'a> {
    chart_type: DomainChartType,
    series: Vec<(usize, &'a ChartSeriesData)>,
}

fn build_modeled_combo_chart_groups(
    spec: &ChartSpec,
    series_data: &[ChartSeriesData],
) -> Option<Vec<ChartGroup>> {
    let groups = modeled_combo_series_groups(spec, series_data)?;
    Some(
        groups
            .iter()
            .map(|group| build_modeled_chart_group(spec, &group.chart_type, group.series.clone()))
            .collect(),
    )
}

fn modeled_combo_series_groups<'a>(
    spec: &ChartSpec,
    series_data: &'a [ChartSeriesData],
) -> Option<Vec<ModeledSeriesGroup<'a>>> {
    if series_data.is_empty() {
        return None;
    }

    if is_volume_stock_sub_type(spec.sub_type.as_ref()) {
        if let Some(groups) = modeled_volume_stock_role_groups(series_data, spec.sub_type.as_ref())
        {
            return Some(groups);
        }
        if let Some(groups) =
            modeled_volume_stock_series_groups(series_data, spec.sub_type.as_ref())
        {
            return Some(groups);
        }
    }

    if spec.chart_type != DomainChartType::Combo {
        return None;
    }

    let mut groups = Vec::new();
    for (idx, series) in series_data.iter().enumerate() {
        let chart_type = series.r#type.clone()?;
        push_modeled_series_group(&mut groups, chart_type, idx, series);
    }

    (groups.len() > 1).then_some(groups)
}

fn is_volume_stock_sub_type(sub_type: Option<&ChartSubType>) -> bool {
    matches!(
        sub_type,
        Some(ChartSubType::VolumeHlc | ChartSubType::VolumeOhlc)
    )
}

fn stock_roles_for_sub_type(
    sub_type: Option<&ChartSubType>,
) -> Option<&'static [ChartSeriesStockRoleData]> {
    use ChartSeriesStockRoleData as Role;

    match sub_type {
        Some(ChartSubType::Hlc | ChartSubType::VolumeHlc) => {
            Some(&[Role::High, Role::Low, Role::Close])
        }
        Some(ChartSubType::Ohlc | ChartSubType::VolumeOhlc) => {
            Some(&[Role::Open, Role::High, Role::Low, Role::Close])
        }
        _ => None,
    }
}

fn modeled_volume_stock_role_groups<'a>(
    series_data: &'a [ChartSeriesData],
    sub_type: Option<&ChartSubType>,
) -> Option<Vec<ModeledSeriesGroup<'a>>> {
    let stock_roles = stock_roles_for_sub_type(sub_type)?;
    if series_data.len() != stock_roles.len() + 1 {
        return None;
    }

    let volume = series_by_stock_role(series_data, ChartSeriesStockRoleData::Volume)?;
    let stock_series = series_by_required_stock_roles(series_data, stock_roles)?;

    Some(vec![
        ModeledSeriesGroup {
            chart_type: DomainChartType::Column,
            series: vec![volume],
        },
        ModeledSeriesGroup {
            chart_type: DomainChartType::Stock,
            series: stock_series,
        },
    ])
}

fn series_by_stock_role(
    series_data: &[ChartSeriesData],
    role: ChartSeriesStockRoleData,
) -> Option<(usize, &ChartSeriesData)> {
    let mut matches = series_data
        .iter()
        .enumerate()
        .filter(|(_, series)| series.stock_role == Some(role));
    let found = matches.next()?;
    matches.next().is_none().then_some(found)
}

fn series_by_required_stock_roles<'a>(
    series_data: &'a [ChartSeriesData],
    roles: &[ChartSeriesStockRoleData],
) -> Option<Vec<(usize, &'a ChartSeriesData)>> {
    roles
        .iter()
        .map(|role| series_by_stock_role(series_data, *role))
        .collect()
}

fn build_modeled_stock_role_chart_group(
    spec: &ChartSpec,
    series_data: &[ChartSeriesData],
) -> Option<ChartGroup> {
    let group = modeled_stock_role_series_group(spec, series_data)?;
    Some(build_modeled_chart_group(
        spec,
        &group.chart_type,
        group.series,
    ))
}

fn modeled_stock_role_series_group<'a>(
    spec: &ChartSpec,
    series_data: &'a [ChartSeriesData],
) -> Option<ModeledSeriesGroup<'a>> {
    if spec.chart_type != DomainChartType::Stock {
        return None;
    }

    let stock_roles = match spec.sub_type.as_ref() {
        Some(ChartSubType::Hlc | ChartSubType::Ohlc) => {
            stock_roles_for_sub_type(spec.sub_type.as_ref())?
        }
        _ => return None,
    };
    if series_data.len() != stock_roles.len() {
        return None;
    }

    Some(ModeledSeriesGroup {
        chart_type: DomainChartType::Stock,
        series: series_by_required_stock_roles(series_data, stock_roles)?,
    })
}

fn modeled_volume_stock_series_groups<'a>(
    series_data: &'a [ChartSeriesData],
    sub_type: Option<&ChartSubType>,
) -> Option<Vec<ModeledSeriesGroup<'a>>> {
    let expected_stock_count = match sub_type {
        Some(ChartSubType::VolumeHlc) => 3,
        Some(ChartSubType::VolumeOhlc) => 4,
        _ => return None,
    };
    if series_data.len() != expected_stock_count + 1 {
        return None;
    }

    let mut groups = Vec::new();
    for (idx, series) in series_data.iter().enumerate() {
        let chart_type = series.r#type.clone().unwrap_or(if idx == 0 {
            DomainChartType::Column
        } else {
            DomainChartType::Stock
        });
        push_modeled_series_group(&mut groups, chart_type, idx, series);
    }

    (groups.len() == 2).then_some(groups)
}

fn push_modeled_series_group<'a>(
    groups: &mut Vec<ModeledSeriesGroup<'a>>,
    chart_type: DomainChartType,
    series_idx: usize,
    series: &'a ChartSeriesData,
) {
    if let Some(last) = groups.last_mut() {
        if last.chart_type == chart_type {
            last.series.push((series_idx, series));
            return;
        }
    }

    groups.push(ModeledSeriesGroup {
        chart_type,
        series: vec![(series_idx, series)],
    });
}

fn build_modeled_chart_group(
    spec: &ChartSpec,
    chart_type: &DomainChartType,
    series_data: Vec<(usize, &ChartSeriesData)>,
) -> ChartGroup {
    let ooxml_ct = domain_to_ooxml_chart_type(chart_type, spec.sub_type.as_ref());
    let series: Vec<_> = series_data
        .iter()
        .map(|(fallback_idx, sd)| build_series(sd, chart_type, *fallback_idx as u32, true))
        .collect();
    let config = build_default_config(ooxml_ct, chart_type, spec, &series);
    let d_lbls = spec.data_labels.as_ref().map(build_data_labels);
    let ax_id = default_axis_ids_for_series_group(ooxml_ct, &series_data);

    ChartGroup {
        chart_type: ooxml_ct,
        config,
        series,
        d_lbls,
        ax_id,
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
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

fn sub_type_to_path_grouping(sub: Option<&ChartSubType>) -> Grouping {
    match sub {
        Some(ChartSubType::Clustered) => Grouping::Clustered,
        Some(ChartSubType::Stacked) => Grouping::Stacked,
        Some(ChartSubType::PercentStacked) => Grouping::PercentStacked,
        _ => Grouping::Standard,
    }
}

fn radar_style_for_sub_type(sub: Option<&ChartSubType>) -> Option<charts::RadarStyle> {
    match sub {
        Some(ChartSubType::Filled) => Some(charts::RadarStyle::Filled),
        Some(ChartSubType::Markers) => Some(charts::RadarStyle::Marker),
        _ => None,
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
        OoxmlChartType::Pie
        | OoxmlChartType::Pie3D
        | OoxmlChartType::Doughnut
        | OoxmlChartType::OfPie => vec![],
        _ => vec![111111111, 222222222],
    }
}

fn default_axis_ids_for_series_group(
    ct: OoxmlChartType,
    series_data: &[(usize, &ChartSeriesData)],
) -> Vec<u32> {
    if default_axis_ids(ct).is_empty() {
        return Vec::new();
    }

    if series_data
        .iter()
        .any(|(_, series)| series.y_axis_index == Some(1))
    {
        vec![333333333, 444444444]
    } else {
        default_axis_ids(ct)
    }
}

/// Build a default ChartTypeConfig for a single-group chart.
pub(super) fn build_default_config(
    ct: OoxmlChartType,
    chart_type: &DomainChartType,
    spec: &ChartSpec,
    _series: &[charts::ChartSeries],
) -> ChartTypeConfig {
    let grouping = sub_type_to_grouping(spec.sub_type.as_ref());
    let path_grouping = sub_type_to_path_grouping(spec.sub_type.as_ref());
    match ct {
        OoxmlChartType::Bar => {
            let bar_dir = bar_direction_for(chart_type);
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
            let bar_dir = bar_direction_for(chart_type);
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
            grouping: path_grouping,
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            hi_low_lines: spec.high_low_lines.as_ref().map(build_chart_lines),
            up_down_bars: spec.up_down_bars.as_ref().map(build_up_down_bars),
            ..Default::default()
        }),
        OoxmlChartType::Line3D => ChartTypeConfig::Line3D(charts::Line3DChartConfig {
            grouping: path_grouping,
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            gap_depth: spec.gap_depth,
            ..Default::default()
        }),
        OoxmlChartType::Pie => ChartTypeConfig::Pie(charts::PieChartConfig {
            vary_colors: spec.vary_by_categories.or(Some(true)),
            first_slice_ang: spec.first_slice_angle,
            ..Default::default()
        }),
        OoxmlChartType::Pie3D => ChartTypeConfig::Pie3D(charts::Pie3DChartConfig {
            vary_colors: spec.vary_by_categories.or(Some(true)),
            ..Default::default()
        }),
        OoxmlChartType::Doughnut => ChartTypeConfig::Doughnut(charts::DoughnutChartConfig {
            vary_colors: spec.vary_by_categories.or(Some(true)),
            hole_size: spec.doughnut_hole_size,
            first_slice_ang: spec.first_slice_angle,
            ..Default::default()
        }),
        OoxmlChartType::Area => ChartTypeConfig::Area(charts::AreaChartConfig {
            grouping: Some(path_grouping),
            drop_lines: spec.drop_lines.as_ref().map(build_chart_lines),
            ..Default::default()
        }),
        OoxmlChartType::Area3D => ChartTypeConfig::Area3D(charts::Area3DChartConfig {
            grouping: Some(path_grouping),
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
        OoxmlChartType::Radar => ChartTypeConfig::Radar(charts::RadarChartConfig {
            radar_style: radar_style_for_sub_type(spec.sub_type.as_ref()).unwrap_or_default(),
            ..Default::default()
        }),
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
            vary_colors: spec.vary_by_categories.or(Some(true)),
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
        ChartTypeConfig::Radar(c) => ChartTypeConfig::Radar(charts::RadarChartConfig {
            radar_style: radar_style_for_sub_type(spec.sub_type.as_ref()).unwrap_or(c.radar_style),
            ..c.clone()
        }),
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
