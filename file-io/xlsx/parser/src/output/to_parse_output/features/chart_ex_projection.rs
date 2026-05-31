use std::collections::{BTreeMap, HashMap};

use domain_types::chart::{
    AxisData, BoxplotConfigData, ChartBorderData, ChartFormatData, ChartSeriesData, DataLabelData,
    HierarchyChartConfigData, HierarchyChartRowData, HistogramConfigData, LegendData,
    PointFormatData, RegionMapConfigData, SingleAxisData, WaterfallOptions,
};
use domain_types::{ChartType, ImportObjectStatus};
use ooxml_types::chart_ex::{
    ChartExAxis, ChartExBinning, ChartExBoundValue, ChartExChartData, ChartExData,
    ChartExDataLabels, ChartExDimension, ChartExFormatOverride, ChartExLayoutId,
    ChartExLayoutProperties, ChartExPlotAreaRegion, ChartExSeries, ChartExSpace, ChartExText,
    ChartExTitle,
};

use crate::domain::charts::read::{
    extract_chart_format, extract_chart_line, extract_chart_rich_text, parse_chart_a1_ref,
    synthesize_rectangular_data_range,
};
use crate::output::results::{FullCellData, FullParsedSheet};

pub(super) struct ChartExProjection {
    pub(super) chart_type: ChartType,
    pub(super) title: Option<String>,
    pub(super) series: Vec<ChartSeriesData>,
    pub(super) legend: Option<LegendData>,
    pub(super) axes: Option<AxisData>,
    pub(super) data_labels: Option<DataLabelData>,
    pub(super) data_range: Option<String>,
    pub(super) chart_format: Option<ChartFormatData>,
    pub(super) plot_format: Option<ChartFormatData>,
    pub(super) title_format: Option<ChartFormatData>,
    pub(super) title_rich_text: Option<Vec<domain_types::chart::ChartFormatStringData>>,
    pub(super) title_formula: Option<String>,
    pub(super) title_h_align: Option<String>,
    pub(super) title_v_align: Option<String>,
    pub(super) waterfall: Option<WaterfallOptions>,
    pub(super) histogram: Option<HistogramConfigData>,
    pub(super) boxplot: Option<BoxplotConfigData>,
    pub(super) hierarchy: Option<HierarchyChartConfigData>,
    pub(super) region_map: Option<RegionMapConfigData>,
    pub(super) import_status: Option<ImportObjectStatus>,
}

pub(super) fn chart_type_from_chart_ex_layout_id(layout_id: &ChartExLayoutId) -> ChartType {
    ChartType::from_chart_ex_layout_id(layout_id)
        .unwrap_or_else(|| ChartType::Unknown(layout_id.to_ooxml().to_string()))
}

pub(super) fn project_chart_ex_space(
    chart_space: &ChartExSpace,
    sheet: &FullParsedSheet,
    original_path: &str,
) -> ChartExProjection {
    let region = &chart_space.chart.plot_area.plot_area_region;
    let data_by_id = chart_ex_data_by_id(&chart_space.chart_data);
    let chart_type = region
        .series
        .first()
        .map(|series| chart_type_from_chart_ex_layout_id(&series.layout_id))
        .unwrap_or_else(|| ChartType::Unknown("unknown".to_string()));
    let title = chart_space
        .chart
        .title
        .as_ref()
        .and_then(chart_ex_title_text);

    let title_formula = chart_space
        .chart
        .title
        .as_ref()
        .and_then(|title| title.tx.as_ref())
        .and_then(|tx| tx.tx_data.as_ref())
        .and_then(|tx_data| tx_data.formula.as_deref())
        .and_then(valid_chart_formula)
        .map(str::to_string);
    let title_rich_text = chart_space
        .chart
        .title
        .as_ref()
        .and_then(|title| title.tx.as_ref())
        .and_then(|tx| tx.rich.as_ref())
        .and_then(extract_chart_rich_text);
    let title_format = chart_space
        .chart
        .title
        .as_ref()
        .and_then(project_chart_ex_title_format);

    let mut formulas = Vec::new();
    let series = project_chart_ex_series(region, &data_by_id, &chart_space.fmt_ovrs, &mut formulas);
    let data_range = synthesize_data_range(&formulas);
    let data_labels = region.series.iter().find_map(|s| {
        s.data_labels
            .as_ref()
            .and_then(project_chart_ex_data_labels)
    });
    let waterfall = project_waterfall(region);
    let histogram = project_histogram(region);
    let boxplot = project_boxplot(region);
    let hierarchy = match chart_type {
        ChartType::Treemap | ChartType::Sunburst => {
            project_hierarchy(region, &data_by_id, sheet, &mut formulas)
        }
        _ => None,
    };
    let region_map = match chart_type {
        ChartType::RegionMap => project_region_map(region, &data_by_id, &mut formulas),
        _ => None,
    };
    let data_range = data_range.or_else(|| synthesize_data_range(&formulas));
    let import_status = chart_ex_import_status(
        &chart_type,
        &series,
        data_range.as_deref(),
        original_path,
        title.as_deref(),
    );

    ChartExProjection {
        chart_type,
        title,
        series,
        legend: chart_space
            .chart
            .legend
            .as_ref()
            .map(project_chart_ex_legend),
        axes: project_chart_ex_axes(&chart_space.chart.plot_area.axes),
        data_labels,
        data_range,
        chart_format: extract_chart_format(chart_space.sp_pr.as_ref(), chart_space.tx_pr.as_ref()),
        plot_format: extract_chart_format(chart_space.chart.plot_area.sp_pr.as_ref(), None),
        title_format,
        title_rich_text,
        title_formula,
        title_h_align: chart_space
            .chart
            .title
            .as_ref()
            .and_then(project_chart_ex_title_h_align),
        title_v_align: chart_space
            .chart
            .title
            .as_ref()
            .and_then(project_chart_ex_title_v_align),
        waterfall,
        histogram,
        boxplot,
        hierarchy,
        region_map,
        import_status,
    }
}

pub(super) fn chart_ex_import_status(
    chart_type: &ChartType,
    series: &[ChartSeriesData],
    data_range: Option<&str>,
    original_path: &str,
    title: Option<&str>,
) -> Option<ImportObjectStatus> {
    match chart_type {
        ChartType::Unknown(raw) => {
            return Some(chart_import_status(
                domain_types::ImportDiagnosticCode::UnsupportedChartType,
                format!(
                    "ChartEx chart type `{}` is not supported for rendering",
                    if raw.is_empty() {
                        "unknown"
                    } else {
                        raw.as_str()
                    }
                ),
                domain_types::ImportRenderability::NotRenderable,
                original_path,
                title,
            ));
        }
        ChartType::Treemap | ChartType::Sunburst | ChartType::RegionMap | ChartType::Pareto => {
            return Some(chart_import_status(
                domain_types::ImportDiagnosticCode::UnsupportedFeature,
                format!(
                    "ChartEx `{}` data projection is preserved but not renderable",
                    chart_type.as_str()
                ),
                domain_types::ImportRenderability::NotRenderable,
                original_path,
                title,
            ));
        }
        _ => {}
    }

    if series.is_empty() {
        return Some(chart_import_status(
            domain_types::ImportDiagnosticCode::ChartPartEmptySeries,
            "Imported ChartEx chart was preserved but has no renderable series data".to_string(),
            domain_types::ImportRenderability::Placeholder,
            original_path,
            title,
        ));
    }

    if series.iter().all(|series| series.values.is_none()) {
        return Some(chart_import_status(
            domain_types::ImportDiagnosticCode::ChartPartMissingDataRange,
            "Imported ChartEx chart was preserved but has no value data range".to_string(),
            domain_types::ImportRenderability::NotRenderable,
            original_path,
            title,
        ));
    }

    if chart_type_requires_categories(chart_type)
        && series.iter().all(|series| series.categories.is_none())
    {
        return Some(chart_import_status(
            domain_types::ImportDiagnosticCode::ChartPartMissingDataRange,
            format!(
                "Imported ChartEx `{}` chart was preserved but has no category data range",
                chart_type.as_str()
            ),
            domain_types::ImportRenderability::NotRenderable,
            original_path,
            title,
        ));
    }

    if data_range.is_none() {
        return Some(chart_import_status(
            domain_types::ImportDiagnosticCode::ChartPartMissingDataRange,
            "Imported ChartEx chart was preserved but its source ranges are not rectangular"
                .to_string(),
            domain_types::ImportRenderability::Placeholder,
            original_path,
            title,
        ));
    }

    None
}

fn chart_type_requires_categories(chart_type: &ChartType) -> bool {
    matches!(
        chart_type,
        ChartType::Waterfall | ChartType::Funnel | ChartType::Boxplot
    )
}

fn chart_import_status(
    code: domain_types::ImportDiagnosticCode,
    message: String,
    renderability: domain_types::ImportRenderability,
    part_path: &str,
    object_name: Option<&str>,
) -> ImportObjectStatus {
    crate::domain::charts::chart_import_status_with_diagnostic(
        crate::domain::charts::ChartImportDiagnosticInput {
            code,
            message,
            recoverability: domain_types::ImportRecoverability::PreservedNotRenderable,
            renderability,
            editability: domain_types::ImportEditability::PartiallyEditable,
            part_path: Some(part_path),
            object_name,
            object_id: None,
        },
    )
}

fn chart_ex_data_by_id(chart_data: &ChartExChartData) -> HashMap<u32, &ChartExData> {
    chart_data.data.iter().map(|data| (data.id, data)).collect()
}

fn project_chart_ex_series(
    region: &ChartExPlotAreaRegion,
    data_by_id: &HashMap<u32, &ChartExData>,
    format_overrides: &[ChartExFormatOverride],
    formulas: &mut Vec<String>,
) -> Vec<ChartSeriesData> {
    region
        .series
        .iter()
        .enumerate()
        .filter_map(|(idx, series)| {
            let data = chart_ex_data_for_series(series, idx, data_by_id, region.series.len())?;
            let categories = chart_ex_dimension_formula(data, DimensionKind::String, "cat")
                .or_else(|| first_dimension_formula(data, DimensionKind::String));
            let values = chart_ex_dimension_formula(data, DimensionKind::Numeric, "val")
                .or_else(|| chart_ex_dimension_formula(data, DimensionKind::Numeric, "size"))
                .or_else(|| first_dimension_formula(data, DimensionKind::Numeric));
            let categories = categories.and_then(valid_chart_formula).map(str::to_string);
            let values = values.and_then(valid_chart_formula).map(str::to_string);

            push_formula(formulas, categories.as_deref());
            push_formula(formulas, values.as_deref());

            Some(ChartSeriesData {
                name: chart_ex_text_text(series.tx.as_ref())
                    .or_else(|| Some(format!("Series {}", idx + 1))),
                r#type: Some(chart_type_from_chart_ex_layout_id(&series.layout_id)),
                color: None,
                values,
                value_cache: None,
                categories,
                category_cache: None,
                category_levels: None,
                category_label_format: None,
                bubble_size: None,
                bubble_size_cache: None,
                smooth: None,
                explosion: None,
                invert_if_negative: None,
                y_axis_index: None,
                show_markers: None,
                marker_size: None,
                marker_style: None,
                line_width: None,
                points: project_chart_ex_points(series),
                data_labels: series
                    .data_labels
                    .as_ref()
                    .and_then(project_chart_ex_data_labels),
                trendlines: None,
                error_bars: None,
                x_error_bars: None,
                y_error_bars: None,
                idx: Some(idx as u32),
                order: Some(idx as u32),
                format: project_chart_ex_series_format(series, idx, format_overrides),
                bar_shape: None,
                invert_color: None,
                marker_background_color: None,
                marker_foreground_color: None,
                filtered: series.hidden,
                show_shadow: None,
                show_connector_lines: series
                    .layout_pr
                    .as_ref()
                    .and_then(|layout| layout.visibility.as_ref())
                    .and_then(|visibility| visibility.connector_lines),
                leader_line_format: None,
                show_leader_lines: None,
            })
        })
        .collect()
}

fn project_chart_ex_series_format(
    series: &ChartExSeries,
    series_idx: usize,
    format_overrides: &[ChartExFormatOverride],
) -> Option<ChartFormatData> {
    let base = extract_chart_format(series.sp_pr.as_ref(), None);
    let override_idx = series.format_idx.unwrap_or(series_idx as u32);
    let override_format = format_overrides
        .iter()
        .find(|override_format| override_format.idx == override_idx)
        .and_then(|override_format| extract_chart_format(override_format.sp_pr.as_ref(), None));
    merge_chart_format(base, override_format)
}

fn merge_chart_format(
    base: Option<ChartFormatData>,
    override_format: Option<ChartFormatData>,
) -> Option<ChartFormatData> {
    match (base, override_format) {
        (Some(mut base), Some(override_format)) => {
            if override_format.fill.is_some() {
                base.fill = override_format.fill;
            }
            if override_format.line.is_some() {
                base.line = override_format.line;
            }
            if override_format.font.is_some() {
                base.font = override_format.font;
            }
            if override_format.text_rotation.is_some() {
                base.text_rotation = override_format.text_rotation;
            }
            if override_format.text_vertical_type.is_some() {
                base.text_vertical_type = override_format.text_vertical_type;
            }
            if override_format.shadow.is_some() {
                base.shadow = override_format.shadow;
            }
            Some(base)
        }
        (Some(base), None) => Some(base),
        (None, Some(override_format)) => Some(override_format),
        (None, None) => None,
    }
}

fn chart_ex_data_for_series<'a>(
    series: &ChartExSeries,
    series_idx: usize,
    data_by_id: &HashMap<u32, &'a ChartExData>,
    series_count: usize,
) -> Option<&'a ChartExData> {
    if let Some(data_id) = series.data_id {
        return data_by_id.get(&data_id).copied();
    }

    if data_by_id.len() == series_count {
        data_by_id.get(&(series_idx as u32)).copied()
    } else if data_by_id.len() == 1 && series_count == 1 {
        data_by_id.values().next().copied()
    } else {
        None
    }
}

#[derive(Clone, Copy)]
enum DimensionKind {
    String,
    Numeric,
}

fn chart_ex_dimension_formula<'a>(
    data: &'a ChartExData,
    kind: DimensionKind,
    dim_type: &str,
) -> Option<&'a str> {
    data.dimensions
        .iter()
        .find_map(|dimension| match dimension {
            ChartExDimension::String {
                dim_type: actual,
                formula,
            } if matches!(kind, DimensionKind::String) && actual == dim_type => {
                Some(formula.content.as_str())
            }
            ChartExDimension::Numeric {
                dim_type: actual,
                formula,
            } if matches!(kind, DimensionKind::Numeric) && actual == dim_type => {
                Some(formula.content.as_str())
            }
            _ => None,
        })
}

fn first_dimension_formula(data: &ChartExData, kind: DimensionKind) -> Option<&str> {
    data.dimensions
        .iter()
        .find_map(|dimension| match dimension {
            ChartExDimension::String { formula, .. } if matches!(kind, DimensionKind::String) => {
                Some(formula.content.as_str())
            }
            ChartExDimension::Numeric { formula, .. } if matches!(kind, DimensionKind::Numeric) => {
                Some(formula.content.as_str())
            }
            _ => None,
        })
}

fn valid_chart_formula(formula: &str) -> Option<&str> {
    let trimmed = formula.trim();
    if trimmed.is_empty() || trimmed.starts_with("_xlchart.") {
        return None;
    }
    synthesize_rectangular_data_range(&[trimmed]).map(|_| trimmed)
}

fn push_formula(formulas: &mut Vec<String>, formula: Option<&str>) {
    if let Some(formula) = formula {
        if !formulas.iter().any(|existing| existing == formula) {
            formulas.push(formula.to_string());
        }
    }
}

fn synthesize_data_range(formulas: &[String]) -> Option<String> {
    let formula_refs = formulas.iter().map(String::as_str).collect::<Vec<_>>();
    synthesize_rectangular_data_range(&formula_refs)
}

fn chart_ex_text_text(text: Option<&ChartExText>) -> Option<String> {
    let text = text?;
    text.tx_data
        .as_ref()
        .and_then(|data| data.value.clone())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            text.rich.as_ref().and_then(|rich| {
                let parts = rich
                    .paragraphs
                    .iter()
                    .flat_map(|paragraph| &paragraph.runs)
                    .filter_map(|run| match run {
                        ooxml_types::drawings::TextRunContent::Run(run) if !run.text.is_empty() => {
                            Some(run.text.clone())
                        }
                        ooxml_types::drawings::TextRunContent::Field {
                            text: Some(text), ..
                        } if !text.is_empty() => Some(text.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                (!parts.is_empty()).then(|| parts.join(""))
            })
        })
}

fn chart_ex_title_text(title: &ChartExTitle) -> Option<String> {
    chart_ex_text_text(title.tx.as_ref())
}

fn project_chart_ex_title_format(title: &ChartExTitle) -> Option<ChartFormatData> {
    let rich = title.tx.as_ref().and_then(|tx| tx.rich.as_ref());
    let mut format = extract_chart_format(title.sp_pr.as_ref(), title.tx_pr.as_ref());
    let rich_format = rich.and_then(|rich| extract_chart_format(None, Some(rich)));
    match (format.as_mut(), rich_format) {
        (Some(format), Some(rich_format)) => {
            if format.font.is_none() {
                format.font = rich_format.font;
            }
            if format.text_rotation.is_none() {
                format.text_rotation = rich_format.text_rotation;
            }
            if format.text_vertical_type.is_none() {
                format.text_vertical_type = rich_format.text_vertical_type;
            }
            format.shadow = format.shadow.take().or(rich_format.shadow);
        }
        (None, Some(rich_format)) => format = Some(rich_format),
        _ => {}
    }
    format
}

fn project_chart_ex_title_h_align(title: &ChartExTitle) -> Option<String> {
    title
        .align
        .as_deref()
        .and_then(chart_ex_horizontal_alignment)
}

fn project_chart_ex_title_v_align(title: &ChartExTitle) -> Option<String> {
    title.pos.as_deref().and_then(chart_ex_vertical_alignment)
}

fn chart_ex_horizontal_alignment(align: &str) -> Option<String> {
    let mapped = match align {
        "l" => "left",
        "ctr" => "center",
        "r" => "right",
        _ => return None,
    };
    Some(mapped.to_string())
}

fn chart_ex_vertical_alignment(pos: &str) -> Option<String> {
    let mapped = match pos {
        "t" => "top",
        "b" => "bottom",
        _ => return None,
    };
    Some(mapped.to_string())
}

fn project_chart_ex_legend(legend: &ooxml_types::chart_ex::ChartExLegend) -> LegendData {
    LegendData {
        show: true,
        position: legend
            .pos
            .as_deref()
            .map(chart_ex_position)
            .unwrap_or("right")
            .to_string(),
        visible: true,
        overlay: legend.overlay,
        format: extract_chart_format(legend.sp_pr.as_ref(), legend.tx_pr.as_ref()),
        entries: None,
        custom_x: None,
        custom_y: None,
        layout: None,
        shadow: None,
        show_shadow: None,
    }
}

fn chart_ex_position(pos: &str) -> &'static str {
    match pos {
        "t" => "top",
        "b" => "bottom",
        "l" => "left",
        "r" => "right",
        "ctr" => "center",
        _ => "right",
    }
}

fn project_chart_ex_axes(axes: &[ChartExAxis]) -> Option<AxisData> {
    let mut category_axis = None;
    let mut value_axis = None;
    let mut secondary_category_axis = None;
    let mut secondary_value_axis = None;

    for axis in axes {
        match axis.scaling {
            Some(ooxml_types::chart_ex::ChartExScaling::Category { .. }) => {
                if category_axis.is_none() {
                    category_axis = Some(project_chart_ex_axis(axis, "category"));
                } else if secondary_category_axis.is_none() {
                    secondary_category_axis = Some(project_chart_ex_axis(axis, "category"));
                }
            }
            Some(ooxml_types::chart_ex::ChartExScaling::Value { .. }) => {
                if value_axis.is_none() {
                    value_axis = Some(project_chart_ex_axis(axis, "value"));
                } else if secondary_value_axis.is_none() {
                    secondary_value_axis = Some(project_chart_ex_axis(axis, "value"));
                }
            }
            None => {}
        }
    }

    if category_axis.is_none() && value_axis.is_none() {
        return None;
    }

    Some(AxisData {
        category_axis,
        value_axis,
        secondary_category_axis,
        secondary_value_axis,
        series_axis: None,
    })
}

fn project_chart_ex_axis(axis: &ChartExAxis, axis_type: &str) -> SingleAxisData {
    let (min, max) = match &axis.scaling {
        Some(ooxml_types::chart_ex::ChartExScaling::Value { min, max }) => (
            min.as_deref().and_then(|min| min.parse().ok()),
            max.as_deref().and_then(|max| max.parse().ok()),
        ),
        _ => (None, None),
    };

    SingleAxisData {
        title: axis.title.as_ref().and_then(chart_ex_title_text),
        visible: !axis.hidden.unwrap_or(false),
        min,
        max,
        axis_type: Some(axis_type.to_string()),
        grid_lines: axis.major_gridlines.as_ref().map(|_| true),
        minor_grid_lines: axis.minor_gridlines.as_ref().map(|_| true),
        major_unit: None,
        minor_unit: None,
        tick_marks: axis
            .major_tick_marks
            .as_ref()
            .and_then(|ticks| ticks.tick_type.clone()),
        minor_tick_marks: axis
            .minor_tick_marks
            .as_ref()
            .and_then(|ticks| ticks.tick_type.clone()),
        number_format: axis.num_fmt.as_ref().map(|fmt| fmt.format_code.clone()),
        reverse: None,
        position: None,
        log_base: None,
        display_unit: None,
        format: extract_chart_format(axis.sp_pr.as_ref(), axis.tx_pr.as_ref()),
        title_format: axis.title.as_ref().and_then(project_chart_ex_title_format),
        gridline_format: axis
            .major_gridlines
            .as_ref()
            .and_then(|gridlines| gridlines.sp_pr.as_ref())
            .and_then(|sp_pr| sp_pr.ln.as_ref())
            .map(extract_chart_line),
        minor_gridline_format: axis
            .minor_gridlines
            .as_ref()
            .and_then(|gridlines| gridlines.sp_pr.as_ref())
            .and_then(|sp_pr| sp_pr.ln.as_ref())
            .map(extract_chart_line),
        cross_between: None,
        tick_label_position: axis.tick_labels.then(|| "nextTo".to_string()),
        base_time_unit: None,
        major_time_unit: None,
        minor_time_unit: None,
        custom_display_unit: None,
        display_unit_label: None,
        label_alignment: None,
        label_offset: None,
        no_multi_level_labels: None,
        title_visible: axis.title.as_ref().map(|_| true),
        tick_label_spacing: None,
        tick_mark_spacing: None,
        link_number_format: axis.num_fmt.as_ref().and_then(|fmt| fmt.source_linked),
        scale_type: Some("linear".to_string()),
        category_type: (axis_type == "category").then(|| "automatic".to_string()),
        crosses_at: None,
        crosses_at_value: None,
        is_between_categories: None,
        text_orientation: None,
        alignment: None,
    }
}

fn project_chart_ex_data_labels(labels: &ChartExDataLabels) -> Option<DataLabelData> {
    let visual_format = extract_chart_format(labels.sp_pr.as_ref(), labels.tx_pr.as_ref());
    let has_visibility = labels.visibility.is_some();
    if labels.pos.is_none()
        && labels.num_fmt.is_none()
        && labels.separator.is_none()
        && visual_format.is_none()
        && !has_visibility
    {
        return None;
    }

    Some(DataLabelData {
        show: true,
        delete: None,
        position: labels.pos.clone(),
        format: None,
        show_value: labels
            .visibility
            .as_ref()
            .and_then(|visibility| visibility.value),
        show_category_name: labels
            .visibility
            .as_ref()
            .and_then(|visibility| visibility.category_name),
        show_series_name: labels
            .visibility
            .as_ref()
            .and_then(|visibility| visibility.series_name),
        show_percentage: None,
        show_bubble_size: None,
        show_legend_key: None,
        separator: labels.separator.clone(),
        show_leader_lines: None,
        text: None,
        visual_format,
        number_format: labels.num_fmt.as_ref().map(|fmt| fmt.format_code.clone()),
        text_orientation: None,
        rich_text: None,
        auto_text: None,
        horizontal_alignment: None,
        vertical_alignment: None,
        link_number_format: labels.num_fmt.as_ref().and_then(|fmt| fmt.source_linked),
        geometric_shape_type: None,
        formula: None,
        leader_lines_format: None,
        layout: None,
    })
}

fn project_chart_ex_points(series: &ChartExSeries) -> Option<Vec<PointFormatData>> {
    let points = series
        .data_points
        .iter()
        .filter_map(|point| {
            let sp_pr = point.sp_pr.as_ref()?;
            let border = sp_pr.ln.as_ref().map(|line| {
                let line = extract_chart_line(line);
                ChartBorderData {
                    color: line.color.and_then(chart_color_string),
                    width: line.width,
                    style: line.dash_style.map(|style| format!("{style:?}")),
                }
            });
            Some(PointFormatData {
                idx: point.idx,
                invert_if_negative: None,
                explosion: None,
                bubble_3d: None,
                fill: None,
                border,
                line_format: None,
                data_label: None,
                visual_format: extract_chart_format(Some(sp_pr), None),
                marker_background_color: None,
                marker_foreground_color: None,
                marker_size: None,
                marker_style: None,
            })
        })
        .collect::<Vec<_>>();
    (!points.is_empty()).then_some(points)
}

fn chart_color_string(color: domain_types::chart::ChartColorData) -> Option<String> {
    match color {
        domain_types::chart::ChartColorData::Hex(value) => Some(value),
        domain_types::chart::ChartColorData::Theme { .. } => None,
    }
}

fn project_waterfall(region: &ChartExPlotAreaRegion) -> Option<WaterfallOptions> {
    let layout = first_layout(region)?;
    let subtotal_indices = layout
        .subtotals
        .as_ref()
        .map(|subtotals| subtotals.idx.clone())
        .unwrap_or_default();
    let show_connector_lines = layout
        .visibility
        .as_ref()
        .and_then(|visibility| visibility.connector_lines);

    if subtotal_indices.is_empty() && show_connector_lines.is_none() {
        return None;
    }

    Some(WaterfallOptions {
        subtotal_indices,
        show_connector_lines,
    })
}

fn project_histogram(region: &ChartExPlotAreaRegion) -> Option<HistogramConfigData> {
    first_layout(region)
        .and_then(|layout| layout.binning.as_ref())
        .map(project_histogram_binning)
}

fn project_histogram_binning(binning: &ChartExBinning) -> HistogramConfigData {
    let (underflow_bin, underflow_bin_value) = bound_value(&binning.underflow);
    let (overflow_bin, overflow_bin_value) = bound_value(&binning.overflow);
    HistogramConfigData {
        bin_count: binning.bin_count,
        bin_width: binning.bin_size,
        overflow_bin,
        overflow_bin_value,
        underflow_bin,
        underflow_bin_value,
    }
}

fn bound_value(value: &Option<ChartExBoundValue>) -> (Option<bool>, Option<f64>) {
    match value {
        Some(ChartExBoundValue::Auto) => (Some(false), None),
        Some(ChartExBoundValue::Value(value)) => (Some(true), Some(*value)),
        None => (None, None),
    }
}

fn project_boxplot(region: &ChartExPlotAreaRegion) -> Option<BoxplotConfigData> {
    let layout = first_layout(region)?;
    let visibility = layout.visibility.as_ref();
    let statistics = layout.statistics.as_ref();
    let config = BoxplotConfigData {
        show_outlier_points: visibility.and_then(|visibility| visibility.outlier_points),
        show_mean_markers: visibility.and_then(|visibility| visibility.mean_marker),
        show_mean_line: visibility.and_then(|visibility| visibility.mean_line),
        quartile_method: statistics.and_then(|statistics| statistics.quartile_method.clone()),
    };

    if config.show_outlier_points.is_none()
        && config.show_mean_markers.is_none()
        && config.show_mean_line.is_none()
        && config.quartile_method.is_none()
    {
        return None;
    }

    Some(config)
}

fn first_layout(region: &ChartExPlotAreaRegion) -> Option<&ChartExLayoutProperties> {
    region
        .series
        .iter()
        .find_map(|series| series.layout_pr.as_ref())
}

fn project_hierarchy(
    region: &ChartExPlotAreaRegion,
    data_by_id: &HashMap<u32, &ChartExData>,
    sheet: &FullParsedSheet,
    formulas: &mut Vec<String>,
) -> Option<HierarchyChartConfigData> {
    let series = region.series.first()?;
    let data = chart_ex_data_for_series(series, 0, data_by_id, region.series.len())?;
    let category_formulas = data
        .dimensions
        .iter()
        .filter_map(|dimension| match dimension {
            ChartExDimension::String { formula, .. } => valid_chart_formula(&formula.content),
            _ => None,
        })
        .map(str::to_string)
        .collect::<Vec<_>>();
    let value_formula = chart_ex_dimension_formula(data, DimensionKind::Numeric, "size")
        .or_else(|| chart_ex_dimension_formula(data, DimensionKind::Numeric, "val"))
        .and_then(valid_chart_formula)
        .map(str::to_string);

    for formula in &category_formulas {
        push_formula(formulas, Some(formula.as_str()));
    }
    push_formula(formulas, value_formula.as_deref());

    if category_formulas.is_empty() && value_formula.is_none() {
        return None;
    }

    let rows = hierarchy_rows(sheet, &category_formulas, value_formula.as_deref());
    Some(HierarchyChartConfigData {
        rows,
        category_formulas,
        value_formula,
        parent_label_layout: series
            .layout_pr
            .as_ref()
            .and_then(|layout| layout.parent_label_layout.clone()),
    })
}

fn hierarchy_rows(
    sheet: &FullParsedSheet,
    category_formulas: &[String],
    value_formula: Option<&str>,
) -> Vec<HierarchyChartRowData> {
    let categories = category_formulas
        .iter()
        .map(|formula| range_values(sheet, formula))
        .collect::<Vec<_>>();
    let values = value_formula.and_then(|formula| range_values(sheet, formula));
    let row_count = categories
        .iter()
        .filter_map(|values| values.as_ref().map(Vec::len))
        .chain(values.as_ref().map(Vec::len))
        .max()
        .unwrap_or(0);
    if row_count == 0 {
        return Vec::new();
    }

    let mut rows_by_id = BTreeMap::<String, HierarchyChartRowData>::new();
    for row_idx in 0..row_count {
        let mut parent_id = None;
        let mut path = Vec::new();
        for (level, formula_values) in categories.iter().enumerate() {
            let Some(label) = formula_values
                .as_ref()
                .and_then(|values| values.get(row_idx))
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            path.push(label.clone());
            let id = path.join("/");
            let is_leaf = level == categories.len() - 1;
            rows_by_id
                .entry(id.clone())
                .or_insert_with(|| HierarchyChartRowData {
                    id: id.clone(),
                    parent_id: parent_id.clone(),
                    label: label.clone(),
                    level: level as u32,
                    value: is_leaf
                        .then(|| {
                            values
                                .as_ref()
                                .and_then(|values| values.get(row_idx))
                                .and_then(|value| value.parse::<f64>().ok())
                        })
                        .flatten(),
                    category_formula: category_formulas.get(level).cloned(),
                    value_formula: is_leaf.then(|| value_formula.map(str::to_string)).flatten(),
                });
            parent_id = Some(id);
        }
    }

    rows_by_id.into_values().collect()
}

fn project_region_map(
    region: &ChartExPlotAreaRegion,
    data_by_id: &HashMap<u32, &ChartExData>,
    formulas: &mut Vec<String>,
) -> Option<RegionMapConfigData> {
    let series = region.series.first()?;
    let data = chart_ex_data_for_series(series, 0, data_by_id, region.series.len())?;
    let region_formula = chart_ex_dimension_formula(data, DimensionKind::String, "cat")
        .or_else(|| first_dimension_formula(data, DimensionKind::String))
        .and_then(valid_chart_formula)
        .map(str::to_string);
    let value_formula = chart_ex_dimension_formula(data, DimensionKind::Numeric, "val")
        .or_else(|| first_dimension_formula(data, DimensionKind::Numeric))
        .and_then(valid_chart_formula)
        .map(str::to_string);

    push_formula(formulas, region_formula.as_deref());
    push_formula(formulas, value_formula.as_deref());

    if region_formula.is_none() && value_formula.is_none() {
        return None;
    }

    Some(RegionMapConfigData {
        region_formula,
        value_formula,
    })
}

fn range_values(sheet: &FullParsedSheet, formula: &str) -> Option<Vec<String>> {
    let parsed = parse_chart_a1_ref(formula)?;
    if parsed
        .sheet
        .as_ref()
        .is_some_and(|formula_sheet| formula_sheet != &sheet.name)
    {
        return None;
    }

    let cells = sheet
        .cells
        .iter()
        .map(|cell| ((cell.row, cell.col), cell))
        .collect::<HashMap<_, _>>();
    let mut values = Vec::new();
    for row in parsed.start_row..=parsed.end_row {
        for col in parsed.start_col..=parsed.end_col {
            values.push(cell_text(cells.get(&(row, col)).copied()));
        }
    }
    Some(values)
}

fn cell_text(cell: Option<&FullCellData>) -> String {
    cell.and_then(|cell| cell.value.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::chart_ex::{
        ChartExChart, ChartExChartData, ChartExFormula, ChartExLayoutVisibility, ChartExPlotArea,
        ChartExSubtotals, ChartExTxData,
    };
    use ooxml_types::drawings::{DrawingColor, DrawingFill, ShapeProperties, SolidFill};

    fn formula(content: &str) -> ChartExFormula {
        ChartExFormula {
            dir: None,
            content: content.to_string(),
        }
    }

    fn full_sheet() -> FullParsedSheet {
        FullParsedSheet {
            name: "Sheet1".to_string(),
            ..Default::default()
        }
    }

    fn chart_series(
        chart_type: ChartType,
        categories: Option<&str>,
        values: Option<&str>,
    ) -> ChartSeriesData {
        ChartSeriesData {
            name: None,
            r#type: Some(chart_type),
            color: None,
            values: values.map(str::to_string),
            value_cache: None,
            categories: categories.map(str::to_string),
            category_cache: None,
            category_levels: None,
            category_label_format: None,
            bubble_size: None,
            bubble_size_cache: None,
            smooth: None,
            explosion: None,
            invert_if_negative: None,
            y_axis_index: None,
            show_markers: None,
            marker_size: None,
            marker_style: None,
            line_width: None,
            points: None,
            data_labels: None,
            trendlines: None,
            error_bars: None,
            x_error_bars: None,
            y_error_bars: None,
            idx: None,
            order: None,
            format: None,
            bar_shape: None,
            invert_color: None,
            marker_background_color: None,
            marker_foreground_color: None,
            filtered: None,
            show_shadow: None,
            show_connector_lines: None,
            leader_line_format: None,
            show_leader_lines: None,
        }
    }

    fn solid_shape(hex: &str) -> ShapeProperties {
        ShapeProperties {
            fill: Some(DrawingFill::Solid(SolidFill {
                color: DrawingColor::SrgbClr {
                    val: hex.to_string(),
                    transforms: Vec::new(),
                },
            })),
            ..Default::default()
        }
    }

    #[test]
    fn chart_ex_layout_ids_map_to_public_chart_types_without_prefixes() {
        for (layout_id, expected) in [
            (ChartExLayoutId::Waterfall, ChartType::Waterfall),
            (ChartExLayoutId::Treemap, ChartType::Treemap),
            (ChartExLayoutId::Sunburst, ChartType::Sunburst),
            (ChartExLayoutId::Funnel, ChartType::Funnel),
            (ChartExLayoutId::RegionMap, ChartType::RegionMap),
            (ChartExLayoutId::Histogram, ChartType::Histogram),
            (ChartExLayoutId::Pareto, ChartType::Pareto),
            (ChartExLayoutId::BoxWhisker, ChartType::Boxplot),
        ] {
            let chart_type = chart_type_from_chart_ex_layout_id(&layout_id);
            assert_eq!(chart_type, expected);
            assert!(!chart_type.as_str().starts_with("chartEx:"));
        }
    }

    #[test]
    fn chart_ex_unknown_layout_ids_remain_unsupported_chart_types() {
        assert_eq!(
            chart_type_from_chart_ex_layout_id(&ChartExLayoutId::ClusteredBar),
            ChartType::Unknown("clusteredBar".to_string())
        );
        assert_eq!(
            chart_type_from_chart_ex_layout_id(&ChartExLayoutId::Other("futureLayout".to_string())),
            ChartType::Unknown("futureLayout".to_string())
        );
    }

    #[test]
    fn projects_waterfall_series_and_layout_options() {
        let mut chart_space = ChartExSpace::default();
        chart_space.chart_data = ChartExChartData {
            data: vec![ChartExData {
                id: 0,
                dimensions: vec![
                    ChartExDimension::String {
                        dim_type: "cat".to_string(),
                        formula: formula("Sheet1!A1:A3"),
                    },
                    ChartExDimension::Numeric {
                        dim_type: "val".to_string(),
                        formula: formula("Sheet1!B1:B3"),
                    },
                ],
            }],
        };
        chart_space.chart = ChartExChart {
            title: Some(ChartExTitle {
                tx: Some(ChartExText {
                    tx_data: Some(ChartExTxData {
                        formula: None,
                        value: Some("Cash Flow".to_string()),
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            plot_area: ChartExPlotArea {
                plot_area_region: ChartExPlotAreaRegion {
                    series: vec![ChartExSeries {
                        layout_id: ChartExLayoutId::Waterfall,
                        data_id: Some(0),
                        layout_pr: Some(ChartExLayoutProperties {
                            visibility: Some(ChartExLayoutVisibility {
                                connector_lines: Some(true),
                                ..Default::default()
                            }),
                            subtotals: Some(ChartExSubtotals { idx: vec![2] }),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
            legend: None,
        };

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

        assert_eq!(projected.chart_type, ChartType::Waterfall);
        assert_eq!(projected.title.as_deref(), Some("Cash Flow"));
        assert_eq!(projected.series.len(), 1);
        assert_eq!(
            projected.series[0].categories.as_deref(),
            Some("Sheet1!A1:A3")
        );
        assert_eq!(projected.series[0].values.as_deref(), Some("Sheet1!B1:B3"));
        assert_eq!(projected.data_range.as_deref(), Some("Sheet1!A1:B3"));
        assert_eq!(
            projected.waterfall,
            Some(WaterfallOptions {
                subtotal_indices: vec![2],
                show_connector_lines: Some(true),
            })
        );
        assert!(projected.import_status.is_none());
    }

    #[test]
    fn supported_category_families_missing_categories_are_not_renderable() {
        for chart_type in [ChartType::Waterfall, ChartType::Funnel, ChartType::Boxplot] {
            let status = chart_ex_import_status(
                &chart_type,
                &[chart_series(chart_type.clone(), None, Some("Sheet1!B1:B3"))],
                Some("Sheet1!B1:B3"),
                "xl/charts/chartEx1.xml",
                None,
            )
            .expect("missing required categories should be diagnosed");

            assert_eq!(
                status.renderability,
                domain_types::ImportRenderability::NotRenderable
            );
            assert_eq!(
                status.diagnostics[0].code,
                Some(domain_types::ImportDiagnosticCode::ChartPartMissingDataRange)
            );
        }
    }

    #[test]
    fn applies_format_overrides_to_matching_series_format_index() {
        let mut chart_space = ChartExSpace::default();
        chart_space.chart_data = ChartExChartData {
            data: vec![ChartExData {
                id: 0,
                dimensions: vec![
                    ChartExDimension::String {
                        dim_type: "cat".to_string(),
                        formula: formula("Sheet1!A1:A3"),
                    },
                    ChartExDimension::Numeric {
                        dim_type: "val".to_string(),
                        formula: formula("Sheet1!B1:B3"),
                    },
                ],
            }],
        };
        chart_space.fmt_ovrs = vec![ChartExFormatOverride {
            idx: 7,
            sp_pr: Some(solid_shape("FF0000")),
        }];
        chart_space.chart = ChartExChart {
            plot_area: ChartExPlotArea {
                plot_area_region: ChartExPlotAreaRegion {
                    series: vec![ChartExSeries {
                        layout_id: ChartExLayoutId::Funnel,
                        data_id: Some(0),
                        format_idx: Some(7),
                        sp_pr: Some(solid_shape("00FF00")),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

        let fill = projected.series[0]
            .format
            .as_ref()
            .and_then(|format| format.fill.as_ref())
            .expect("override fill should be projected");
        assert_eq!(
            fill,
            &domain_types::chart::ChartFillData::Solid {
                color: domain_types::chart::ChartColorData::Hex("FF0000".to_string()),
                transparency: None,
            }
        );
    }

    #[test]
    fn projects_secondary_chart_ex_axes_and_title_alignment() {
        let chart_space = ChartExSpace {
            chart: ChartExChart {
                title: Some(ChartExTitle {
                    pos: Some("t".to_string()),
                    align: Some("ctr".to_string()),
                    ..Default::default()
                }),
                plot_area: ChartExPlotArea {
                    axes: vec![
                        ChartExAxis {
                            scaling: Some(ooxml_types::chart_ex::ChartExScaling::Category {
                                gap_width: None,
                            }),
                            ..Default::default()
                        },
                        ChartExAxis {
                            scaling: Some(ooxml_types::chart_ex::ChartExScaling::Value {
                                min: Some("1".to_string()),
                                max: Some("10".to_string()),
                            }),
                            ..Default::default()
                        },
                        ChartExAxis {
                            scaling: Some(ooxml_types::chart_ex::ChartExScaling::Value {
                                min: Some("0".to_string()),
                                max: Some("100".to_string()),
                            }),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

        let axes = projected.axes.expect("axes should be projected");
        assert_eq!(axes.value_axis.and_then(|axis| axis.min), Some(1.0));
        assert_eq!(
            axes.secondary_value_axis.and_then(|axis| axis.max),
            Some(100.0)
        );
        assert_eq!(projected.title_h_align.as_deref(), Some("center"));
        assert_eq!(projected.title_v_align.as_deref(), Some("top"));
    }

    #[test]
    fn projects_histogram_and_boxplot_options() {
        let histogram = project_histogram_binning(&ChartExBinning {
            bin_count: Some(8),
            bin_size: Some(2.5),
            underflow: Some(ChartExBoundValue::Value(1.0)),
            overflow: Some(ChartExBoundValue::Auto),
            interval_closed: None,
        });
        assert_eq!(histogram.bin_count, Some(8));
        assert_eq!(histogram.bin_width, Some(2.5));
        assert_eq!(histogram.underflow_bin, Some(true));
        assert_eq!(histogram.underflow_bin_value, Some(1.0));
        assert_eq!(histogram.overflow_bin, Some(false));
        assert_eq!(histogram.overflow_bin_value, None);
    }

    #[test]
    fn unsupported_chart_ex_families_are_preserved_not_renderable() {
        let status = chart_ex_import_status(
            &ChartType::RegionMap,
            &[chart_series(
                ChartType::RegionMap,
                Some("Sheet1!A1:A2"),
                Some("Sheet1!B1:B2"),
            )],
            Some("Sheet1!A1:B2"),
            "xl/charts/chartEx2.xml",
            Some("Map"),
        )
        .expect("region maps are not renderable yet");

        assert_eq!(
            status.recoverability,
            domain_types::ImportRecoverability::PreservedNotRenderable
        );
        assert_eq!(
            status.renderability,
            domain_types::ImportRenderability::NotRenderable
        );
        assert_eq!(
            status.diagnostics[0].code,
            Some(domain_types::ImportDiagnosticCode::UnsupportedFeature)
        );
    }
}
