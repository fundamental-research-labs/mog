use std::collections::{BTreeMap, HashMap};

use domain_types::chart::{
    AxisData, BoxplotConfigData, ChartBorderData, ChartFormatData, ChartSeriesData, DataLabelData,
    HierarchyChartConfigData, HierarchyChartRowData, HistogramConfigData, LegendData,
    PointFormatData, RegionMapConfigData, SingleAxisData, WaterfallOptions,
};
use domain_types::{ChartStyleContextData, ChartStyleOwnerData, ChartType, ImportObjectStatus};
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
    pub(super) chart_style_context: Option<ChartStyleContextData>,
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

#[derive(Debug, Clone)]
struct ProjectionDiagnostic {
    code: domain_types::ImportDiagnosticCode,
    message: String,
}

fn push_projection_diagnostic(
    diagnostics: &mut Vec<ProjectionDiagnostic>,
    code: domain_types::ImportDiagnosticCode,
    message: impl Into<String>,
) {
    diagnostics.push(ProjectionDiagnostic {
        code,
        message: message.into(),
    });
}

pub(super) fn project_chart_ex_space(
    chart_space: &ChartExSpace,
    sheet: &FullParsedSheet,
    original_path: &str,
) -> ChartExProjection {
    let region = &chart_space.chart.plot_area.plot_area_region;
    let data_by_id = chart_ex_data_by_id(&chart_space.chart_data);
    let mut projection_diagnostics = Vec::new();
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
        .and_then(|formula| {
            project_chart_formula(formula, "title formula", &mut projection_diagnostics)
        })
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
    if let Some(title) = chart_space.chart.title.as_ref() {
        diagnose_title_projection_gaps(title, &mut projection_diagnostics);
    }
    if let Some(legend) = chart_space.chart.legend.as_ref() {
        diagnose_legend_projection_gaps(legend, &mut projection_diagnostics);
    }

    let mut formulas = Vec::new();
    let has_secondary_value_axis = chart_ex_value_axis_count(&chart_space.chart.plot_area.axes) > 1;
    let series = project_chart_ex_series(
        region,
        &chart_space.chart_data,
        &data_by_id,
        &chart_space.fmt_ovrs,
        has_secondary_value_axis,
        &mut formulas,
        &mut projection_diagnostics,
    );
    let data_range = synthesize_data_range(&formulas);
    let data_labels = region.series.iter().find_map(|s| {
        s.data_labels
            .as_ref()
            .and_then(project_chart_ex_data_labels)
    });
    let waterfall = project_waterfall(region);
    let histogram = project_histogram(region, &mut projection_diagnostics);
    let boxplot = project_boxplot(region, &mut projection_diagnostics);
    let hierarchy = match chart_type {
        ChartType::Treemap | ChartType::Sunburst => project_hierarchy(
            region,
            &chart_space.chart_data,
            &data_by_id,
            sheet,
            &mut formulas,
            &mut projection_diagnostics,
        ),
        _ => None,
    };
    let region_map = match chart_type {
        ChartType::RegionMap => project_region_map(
            region,
            &chart_space.chart_data,
            &data_by_id,
            &mut formulas,
            &mut projection_diagnostics,
        ),
        _ => None,
    };
    let data_range = data_range.or_else(|| synthesize_data_range(&formulas));
    let axes = project_chart_ex_axes(
        &chart_space.chart.plot_area.axes,
        &mut projection_diagnostics,
    );
    let legend = chart_space
        .chart
        .legend
        .as_ref()
        .map(project_chart_ex_legend);
    let chart_format = extract_chart_format(chart_space.sp_pr.as_ref(), chart_space.tx_pr.as_ref());
    let plot_area_format = extract_chart_format(chart_space.chart.plot_area.sp_pr.as_ref(), None);
    let plot_area_region_format = extract_chart_format(region.sp_pr.as_ref(), None);
    if plot_area_format.is_some() && plot_area_region_format.is_some() {
        push_projection_diagnostic(
            &mut projection_diagnostics,
            domain_types::ImportDiagnosticCode::UnsupportedFeature,
            "ChartEx plotArea and plotAreaRegion styles were merged for rendering; separate style owners are preserved for export",
        );
    }
    let plot_format = merge_chart_format(plot_area_format, plot_area_region_format);
    let chart_style_context = project_chart_ex_style_context(ChartExStyleContextInputs {
        chart_format: chart_format.as_ref(),
        plot_format: plot_format.as_ref(),
        title_format: title_format.as_ref(),
        title_rich_text: title_rich_text.as_deref(),
        legend: legend.as_ref(),
        axes: axes.as_ref(),
        series: &series,
    });
    let import_status = attach_projection_diagnostics(
        chart_ex_import_status(
            &chart_type,
            &series,
            data_range.as_deref(),
            original_path,
            title.as_deref(),
        ),
        projection_diagnostics,
        original_path,
        title.as_deref(),
    );

    ChartExProjection {
        chart_type,
        title,
        series,
        legend,
        axes,
        data_labels,
        data_range,
        chart_format,
        plot_format,
        title_format,
        title_rich_text,
        chart_style_context,
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

struct ChartExStyleContextInputs<'a> {
    chart_format: Option<&'a ChartFormatData>,
    plot_format: Option<&'a ChartFormatData>,
    title_format: Option<&'a ChartFormatData>,
    title_rich_text: Option<&'a [domain_types::chart::ChartFormatStringData]>,
    legend: Option<&'a LegendData>,
    axes: Option<&'a AxisData>,
    series: &'a [ChartSeriesData],
}

fn project_chart_ex_style_context(
    inputs: ChartExStyleContextInputs<'_>,
) -> Option<ChartStyleContextData> {
    let mut context = ChartStyleContextData::default();

    push_chart_ex_style_owner(
        &mut context.owners,
        "chartArea",
        "cx:chartSpace/cx:spPr|cx:chartSpace/cx:txPr",
        inputs.chart_format,
        None,
    );
    push_chart_ex_style_owner(
        &mut context.owners,
        "plotArea",
        "cx:chartSpace/cx:chart/cx:plotArea/cx:spPr|cx:plotAreaRegion/cx:spPr",
        inputs.plot_format,
        None,
    );
    push_chart_ex_style_owner(
        &mut context.owners,
        "title",
        "cx:chartSpace/cx:chart/cx:title",
        inputs.title_format,
        inputs.title_rich_text,
    );

    if let Some(legend) = inputs.legend {
        push_chart_ex_style_owner(
            &mut context.owners,
            "legend",
            "cx:chartSpace/cx:chart/cx:legend",
            legend.format.as_ref(),
            None,
        );
    }

    if let Some(axes) = inputs.axes {
        push_chart_ex_axis_style_owner(
            &mut context.owners,
            "categoryAxis",
            axes.category_axis.as_ref(),
        );
        push_chart_ex_axis_style_owner(&mut context.owners, "valueAxis", axes.value_axis.as_ref());
        push_chart_ex_axis_style_owner(
            &mut context.owners,
            "secondaryCategoryAxis",
            axes.secondary_category_axis.as_ref(),
        );
        push_chart_ex_axis_style_owner(
            &mut context.owners,
            "secondaryValueAxis",
            axes.secondary_value_axis.as_ref(),
        );
        push_chart_ex_axis_style_owner(
            &mut context.owners,
            "seriesAxis",
            axes.series_axis.as_ref(),
        );
    }

    for (index, series) in inputs.series.iter().enumerate() {
        push_chart_ex_style_owner(
            &mut context.owners,
            &format!("series({index})"),
            "cx:chartSpace/cx:chart/cx:plotArea/cx:plotAreaRegion/cx:series",
            series.format.as_ref(),
            None,
        );
    }

    (!context.owners.is_empty()
        || !context.diagnostics.is_empty()
        || context.color_map_override.is_some())
    .then_some(context)
}

fn push_chart_ex_axis_style_owner(
    owners: &mut Vec<ChartStyleOwnerData>,
    owner_key: &str,
    axis: Option<&SingleAxisData>,
) {
    let Some(axis) = axis else {
        return;
    };

    push_chart_ex_style_owner(
        owners,
        owner_key,
        "cx:chartSpace/cx:chart/cx:plotArea/cx:axis",
        axis.format.as_ref(),
        None,
    );
    push_chart_ex_style_owner(
        owners,
        &format!("{owner_key}.title"),
        "cx:chartSpace/cx:chart/cx:plotArea/cx:axis/cx:title",
        axis.title_format.as_ref(),
        axis.title_rich_text.as_deref(),
    );
}

fn push_chart_ex_style_owner(
    owners: &mut Vec<ChartStyleOwnerData>,
    owner_key: &str,
    source_path: &str,
    format: Option<&ChartFormatData>,
    rich_text: Option<&[domain_types::chart::ChartFormatStringData]>,
) {
    let rich_text = rich_text
        .filter(|runs| !runs.is_empty())
        .map(|runs| runs.to_vec());

    if format.is_none() && rich_text.is_none() {
        return;
    }

    owners.push(ChartStyleOwnerData {
        owner_key: owner_key.to_string(),
        source_path: Some(source_path.to_string()),
        edit_owner_id: None,
        format: format.cloned(),
        rich_text,
        diagnostics: Vec::new(),
        imported_drawing_ml: None,
    });
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
        ChartType::Treemap | ChartType::Sunburst | ChartType::RegionMap => {
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
            domain_types::ImportRenderability::NotRenderable,
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
            domain_types::ImportRenderability::NotRenderable,
            original_path,
            title,
        ));
    }

    None
}

fn chart_type_requires_categories(chart_type: &ChartType) -> bool {
    matches!(
        chart_type,
        ChartType::Waterfall | ChartType::Funnel | ChartType::Pareto | ChartType::Boxplot
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

fn attach_projection_diagnostics(
    status: Option<ImportObjectStatus>,
    diagnostics: Vec<ProjectionDiagnostic>,
    part_path: &str,
    object_name: Option<&str>,
) -> Option<ImportObjectStatus> {
    if diagnostics.is_empty() {
        return status;
    }

    let diagnostic_refs = diagnostics
        .into_iter()
        .map(|diagnostic| projection_diagnostic_ref(diagnostic, part_path, object_name))
        .collect::<Vec<_>>();

    let mut status = status.unwrap_or_else(|| ImportObjectStatus {
        source: domain_types::ImportSource::Xlsx,
        feature_kind: domain_types::ImportFeatureKind::Chart,
        recoverability: domain_types::ImportRecoverability::PartiallySupported,
        renderability: domain_types::ImportRenderability::Renderable,
        editability: domain_types::ImportEditability::PartiallyEditable,
        diagnostics: Vec::new(),
        reference: None,
    });

    if status.reference.is_none() {
        status.reference = diagnostic_refs.first().cloned();
    }
    status.diagnostics.extend(diagnostic_refs);
    Some(status)
}

fn projection_diagnostic_ref(
    diagnostic: ProjectionDiagnostic,
    part_path: &str,
    object_name: Option<&str>,
) -> domain_types::ImportDiagnosticRef {
    crate::domain::charts::chart_import_status_with_diagnostic(
        crate::domain::charts::ChartImportDiagnosticInput {
            code: diagnostic.code,
            message: diagnostic.message,
            recoverability: domain_types::ImportRecoverability::PartiallySupported,
            renderability: domain_types::ImportRenderability::Renderable,
            editability: domain_types::ImportEditability::PartiallyEditable,
            part_path: Some(part_path),
            object_name,
            object_id: None,
        },
    )
    .reference
    .expect("chart import diagnostic helper always sets reference")
}

fn chart_ex_data_by_id(chart_data: &ChartExChartData) -> HashMap<u32, &ChartExData> {
    chart_data.data.iter().map(|data| (data.id, data)).collect()
}

fn project_chart_ex_series(
    region: &ChartExPlotAreaRegion,
    chart_data: &ChartExChartData,
    data_by_id: &HashMap<u32, &ChartExData>,
    format_overrides: &[ChartExFormatOverride],
    has_secondary_value_axis: bool,
    formulas: &mut Vec<String>,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Vec<ChartSeriesData> {
    region
        .series
        .iter()
        .enumerate()
        .filter_map(|(idx, series)| {
            let data = chart_ex_data_for_series(
                series,
                idx,
                chart_data,
                data_by_id,
                region.series.len(),
                diagnostics,
            )?;
            diagnose_unprojected_series_dimensions(data, &series.layout_id, diagnostics);
            let categories = chart_ex_dimension_formula(data, DimensionKind::String, "cat");
            let values = chart_ex_dimension_formula(data, DimensionKind::Numeric, "val");
            let categories = categories
                .and_then(|formula| project_chart_formula(formula, "category", diagnostics))
                .map(str::to_string);
            let values = values
                .and_then(|formula| project_chart_formula(formula, "value", diagnostics))
                .map(str::to_string);

            push_formula(formulas, categories.as_deref());
            push_formula(formulas, values.as_deref());
            let value_source_kind = values
                .as_ref()
                .map(|_| domain_types::chart::ChartSeriesDimensionSourceKindData::Ref);
            let category_source_kind = categories
                .as_ref()
                .map(|_| domain_types::chart::ChartSeriesDimensionSourceKindData::Ref);

            Some(ChartSeriesData {
                name: chart_ex_text_text(series.tx.as_ref())
                    .or_else(|| Some(format!("Series {}", idx + 1))),
                name_ref: None,
                r#type: Some(chart_type_from_chart_ex_layout_id(&series.layout_id)),
                color: None,
                stock_role: None,
                values,
                value_cache: None,
                value_source_kind,
                categories,
                x_role: None,
                category_cache: None,
                category_source_kind,
                category_levels: None,
                category_label_format: None,
                bubble_size: None,
                bubble_size_cache: None,
                bubble_size_source_kind: None,
                smooth: None,
                show_lines: None,
                explosion: None,
                invert_if_negative: None,
                y_axis_index: chart_ex_series_y_axis_index(
                    has_secondary_value_axis,
                    idx,
                    region.series.len(),
                    &series.layout_id,
                ),
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
                source_series_index: None,
                source_series_key: None,
                visible_order: None,
                pivot_series_key: None,
                pivot_data_field_index: None,
                projection_authority: None,
                projection_diagnostics: Vec::new(),
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

fn chart_ex_value_axis_count(axes: &[ChartExAxis]) -> usize {
    axes.iter()
        .filter(|axis| {
            matches!(
                axis.scaling.as_ref(),
                Some(ooxml_types::chart_ex::ChartExScaling::Value { .. })
            )
        })
        .count()
}

fn chart_ex_series_y_axis_index(
    has_secondary_value_axis: bool,
    series_idx: usize,
    series_count: usize,
    layout_id: &ChartExLayoutId,
) -> Option<u8> {
    if !has_secondary_value_axis {
        return None;
    }
    if matches!(layout_id, ChartExLayoutId::Pareto) || series_idx > 0 || series_count == 1 {
        Some(1)
    } else {
        None
    }
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
    chart_data: &'a ChartExChartData,
    data_by_id: &HashMap<u32, &'a ChartExData>,
    series_count: usize,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Option<&'a ChartExData> {
    if let Some(data_id) = series.data_id {
        let data = data_by_id.get(&data_id).copied();
        if data.is_none() {
            push_projection_diagnostic(
                diagnostics,
                domain_types::ImportDiagnosticCode::ChartPartMissingDataRange,
                format!(
                    "ChartEx series {} references missing cx:data id {}",
                    series_idx + 1,
                    data_id
                ),
            );
        }
        return data;
    }

    if chart_data.data.len() == series_count {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::UnsupportedFeature,
            format!(
                "ChartEx series {} has no dataId; projected cx:data by series ordinal",
                series_idx + 1
            ),
        );
        chart_data.data.get(series_idx)
    } else if chart_data.data.len() == 1 && series_count == 1 {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::UnsupportedFeature,
            "ChartEx series has no dataId; projected the only cx:data entry".to_string(),
        );
        chart_data.data.first()
    } else {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::ChartPartMissingDataRange,
            format!(
                "ChartEx series {} has no dataId and no unambiguous cx:data fallback",
                series_idx + 1
            ),
        );
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

fn project_chart_formula<'a>(
    formula: &'a str,
    dimension_label: &str,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Option<&'a str> {
    let trimmed = formula.trim();
    if trimmed.is_empty() {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::ChartPartMissingDataRange,
            format!("ChartEx {dimension_label} formula is empty"),
        );
        return None;
    }
    if trimmed.starts_with("_xlchart.") {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::UnsupportedFeature,
            format!(
                "ChartEx {dimension_label} formula `{trimmed}` uses an internal source that is preserved but not renderable"
            ),
        );
        return None;
    }
    if synthesize_rectangular_data_range(&[trimmed]).is_none() {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::InvalidRangeReference,
            format!("ChartEx {dimension_label} formula `{trimmed}` is not a rectangular range"),
        );
        return None;
    }
    Some(trimmed)
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

fn chart_ex_title_rich_text(
    title: &ChartExTitle,
) -> Option<Vec<domain_types::chart::ChartFormatStringData>> {
    title
        .tx
        .as_ref()
        .and_then(|tx| tx.rich.as_ref())
        .and_then(extract_chart_rich_text)
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

fn diagnose_title_projection_gaps(
    title: &ChartExTitle,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) {
    if title.overlay.is_some() {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::UnsupportedFeature,
            "ChartEx title overlay is preserved for export but has no render contract",
        );
    }
    if let Some(pos) = title.pos.as_deref() {
        if chart_ex_vertical_alignment(pos).is_none() {
            push_projection_diagnostic(
                diagnostics,
                domain_types::ImportDiagnosticCode::UnsupportedFeature,
                format!("ChartEx title position `{pos}` is preserved but not rendered"),
            );
        }
    }
    if let Some(align) = title.align.as_deref() {
        if chart_ex_horizontal_alignment(align).is_none() {
            push_projection_diagnostic(
                diagnostics,
                domain_types::ImportDiagnosticCode::UnsupportedFeature,
                format!("ChartEx title alignment `{align}` is preserved but not rendered"),
            );
        }
    }
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

fn diagnose_legend_projection_gaps(
    legend: &ooxml_types::chart_ex::ChartExLegend,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) {
    if let Some(align) = legend.align.as_deref() {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::UnsupportedFeature,
            format!("ChartEx legend alignment `{align}` is preserved but not rendered"),
        );
    }
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

fn project_chart_ex_axes(
    axes: &[ChartExAxis],
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Option<AxisData> {
    let mut category_axis = None;
    let mut value_axis = None;
    let mut secondary_category_axis = None;
    let mut secondary_value_axis = None;

    for axis in axes {
        match &axis.scaling {
            Some(ooxml_types::chart_ex::ChartExScaling::Category { gap_width }) => {
                if let Some(gap_width) = gap_width.as_deref() {
                    push_projection_diagnostic(
                        diagnostics,
                        domain_types::ImportDiagnosticCode::UnsupportedFeature,
                        format!(
                            "ChartEx category axis gapWidth `{gap_width}` is preserved but not rendered"
                        ),
                    );
                }
                if category_axis.is_none() {
                    category_axis = Some(project_chart_ex_axis(axis, "category"));
                } else if secondary_category_axis.is_none() {
                    secondary_category_axis = Some(project_chart_ex_axis(axis, "category"));
                } else {
                    push_projection_diagnostic(
                        diagnostics,
                        domain_types::ImportDiagnosticCode::UnsupportedFeature,
                        "Additional ChartEx category axes beyond primary and secondary are preserved but not rendered",
                    );
                }
            }
            Some(ooxml_types::chart_ex::ChartExScaling::Value { .. }) => {
                if value_axis.is_none() {
                    value_axis = Some(project_chart_ex_axis(axis, "value"));
                } else if secondary_value_axis.is_none() {
                    secondary_value_axis = Some(project_chart_ex_axis(axis, "value"));
                } else {
                    push_projection_diagnostic(
                        diagnostics,
                        domain_types::ImportDiagnosticCode::UnsupportedFeature,
                        "Additional ChartEx value axes beyond primary and secondary are preserved but not rendered",
                    );
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
        visible_explicit: axis.hidden.is_some(),
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
        title_rich_text: axis.title.as_ref().and_then(chart_ex_title_rich_text),
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
        display_unit_label_layout: None,
        display_unit_label_format: None,
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

fn project_histogram(
    region: &ChartExPlotAreaRegion,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Option<HistogramConfigData> {
    first_layout(region)
        .and_then(|layout| layout.binning.as_ref())
        .map(|binning| {
            if let Some(interval_closed) = binning.interval_closed.as_deref() {
                push_projection_diagnostic(
                    diagnostics,
                    domain_types::ImportDiagnosticCode::UnsupportedFeature,
                    format!(
                        "ChartEx histogram intervalClosed `{interval_closed}` is preserved but not rendered"
                    ),
                );
            }
            project_histogram_binning(binning)
        })
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

fn project_boxplot(
    region: &ChartExPlotAreaRegion,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Option<BoxplotConfigData> {
    let layout = first_layout(region)?;
    let visibility = layout.visibility.as_ref();
    let statistics = layout.statistics.as_ref();
    if visibility
        .and_then(|visibility| visibility.non_outlier_points)
        .is_some()
    {
        push_projection_diagnostic(
            diagnostics,
            domain_types::ImportDiagnosticCode::UnsupportedFeature,
            "ChartEx boxplot non-outlier point visibility is preserved but not rendered",
        );
    }
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

fn diagnose_unprojected_series_dimensions(
    data: &ChartExData,
    layout_id: &ChartExLayoutId,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) {
    for dimension in &data.dimensions {
        match dimension {
            ChartExDimension::String { dim_type, .. } if dim_type != "cat" => {
                push_projection_diagnostic(
                    diagnostics,
                    domain_types::ImportDiagnosticCode::UnsupportedFeature,
                    format!(
                        "ChartEx string dimension `{dim_type}` is preserved but not mapped to render categories"
                    ),
                );
            }
            ChartExDimension::Numeric { dim_type, .. }
                if dim_type != "val" && !chart_ex_size_dimension_is_projected(layout_id) =>
            {
                push_projection_diagnostic(
                    diagnostics,
                    domain_types::ImportDiagnosticCode::UnsupportedFeature,
                    format!(
                        "ChartEx numeric dimension `{dim_type}` is preserved but not mapped to render values"
                    ),
                );
            }
            ChartExDimension::Numeric { dim_type, .. }
                if dim_type != "val" && dim_type != "size" =>
            {
                push_projection_diagnostic(
                    diagnostics,
                    domain_types::ImportDiagnosticCode::UnsupportedFeature,
                    format!(
                        "ChartEx numeric dimension `{dim_type}` is preserved but not mapped to render values"
                    ),
                );
            }
            _ => {}
        }
    }
}

fn chart_ex_size_dimension_is_projected(layout_id: &ChartExLayoutId) -> bool {
    matches!(
        layout_id,
        ChartExLayoutId::Treemap | ChartExLayoutId::Sunburst
    )
}

fn first_layout(region: &ChartExPlotAreaRegion) -> Option<&ChartExLayoutProperties> {
    region
        .series
        .iter()
        .find_map(|series| series.layout_pr.as_ref())
}

fn project_hierarchy(
    region: &ChartExPlotAreaRegion,
    chart_data: &ChartExChartData,
    data_by_id: &HashMap<u32, &ChartExData>,
    sheet: &FullParsedSheet,
    formulas: &mut Vec<String>,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Option<HierarchyChartConfigData> {
    let series = region.series.first()?;
    let data = chart_ex_data_for_series(
        series,
        0,
        chart_data,
        data_by_id,
        region.series.len(),
        diagnostics,
    )?;
    let category_formulas = data
        .dimensions
        .iter()
        .filter_map(|dimension| match dimension {
            ChartExDimension::String { formula, .. } => {
                project_chart_formula(&formula.content, "hierarchy category", diagnostics)
            }
            _ => None,
        })
        .map(str::to_string)
        .collect::<Vec<_>>();
    let value_formula = chart_ex_dimension_formula(data, DimensionKind::Numeric, "size")
        .or_else(|| chart_ex_dimension_formula(data, DimensionKind::Numeric, "val"))
        .and_then(|formula| project_chart_formula(formula, "hierarchy value", diagnostics))
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
    chart_data: &ChartExChartData,
    data_by_id: &HashMap<u32, &ChartExData>,
    formulas: &mut Vec<String>,
    diagnostics: &mut Vec<ProjectionDiagnostic>,
) -> Option<RegionMapConfigData> {
    let series = region.series.first()?;
    let data = chart_ex_data_for_series(
        series,
        0,
        chart_data,
        data_by_id,
        region.series.len(),
        diagnostics,
    )?;
    let region_formula = chart_ex_dimension_formula(data, DimensionKind::String, "cat")
        .and_then(|formula| project_chart_formula(formula, "region", diagnostics))
        .map(str::to_string);
    let value_formula = chart_ex_dimension_formula(data, DimensionKind::Numeric, "val")
        .and_then(|formula| project_chart_formula(formula, "region value", diagnostics))
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
        ChartExAxis, ChartExChart, ChartExChartData, ChartExDataLabelVisibility, ChartExFormula,
        ChartExLayoutVisibility, ChartExLegend, ChartExNumberFormat, ChartExPlotArea,
        ChartExScaling, ChartExSubtotals, ChartExTxData,
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

    fn sheet_cell(row: u32, col: u32, value: &str) -> FullCellData {
        FullCellData {
            row,
            col,
            cell_type: crate::output::results::CELL_TYPE_VAL_STRING,
            style_idx: 0,
            value: Some(value.to_string()),
            formula: None,
            force_recalc: false,
            array_ref: None,
            cell_metadata_index: None,
            phonetic: false,
            vm: None,
            date_lexical_value: None,
            cached_value_type: 0,
            cell_formula: None,
            preserve_space_formula: false,
            preserve_space_value: false,
            sst_index: None,
            has_explicit_style: false,
        }
    }

    fn sheet_with_cells(cells: Vec<FullCellData>) -> FullParsedSheet {
        FullParsedSheet {
            name: "Sheet1".to_string(),
            cells,
            ..Default::default()
        }
    }

    fn cat_val_dimensions() -> Vec<ChartExDimension> {
        vec![
            ChartExDimension::String {
                dim_type: "cat".to_string(),
                formula: formula("Sheet1!A1:A3"),
            },
            ChartExDimension::Numeric {
                dim_type: "val".to_string(),
                formula: formula("Sheet1!B1:B3"),
            },
        ]
    }

    fn chart_space_with_series(
        layout_id: ChartExLayoutId,
        dimensions: Vec<ChartExDimension>,
        layout_pr: Option<ChartExLayoutProperties>,
    ) -> ChartExSpace {
        let mut chart_space = ChartExSpace::default();
        chart_space.chart_data = ChartExChartData {
            data: vec![ChartExData { id: 0, dimensions }],
        };
        chart_space.chart = ChartExChart {
            plot_area: ChartExPlotArea {
                plot_area_region: ChartExPlotAreaRegion {
                    series: vec![ChartExSeries {
                        layout_id,
                        data_id: Some(0),
                        layout_pr,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };
        chart_space
    }

    fn chart_series(
        chart_type: ChartType,
        categories: Option<&str>,
        values: Option<&str>,
    ) -> ChartSeriesData {
        ChartSeriesData {
            name: None,
            name_ref: None,
            r#type: Some(chart_type),
            color: None,
            stock_role: None,
            values: values.map(str::to_string),
            value_cache: None,
            value_source_kind: values
                .map(|_| domain_types::chart::ChartSeriesDimensionSourceKindData::Ref),
            categories: categories.map(str::to_string),
            x_role: None,
            category_cache: None,
            category_source_kind: categories
                .map(|_| domain_types::chart::ChartSeriesDimensionSourceKindData::Ref),
            category_levels: None,
            category_label_format: None,
            bubble_size: None,
            bubble_size_cache: None,
            bubble_size_source_kind: None,
            smooth: None,
            show_lines: None,
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
            source_series_index: None,
            source_series_key: None,
            visible_order: None,
            pivot_series_key: None,
            pivot_data_field_index: None,
            projection_authority: None,
            projection_diagnostics: Vec::new(),
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

    fn owner<'a>(context: &'a ChartStyleContextData, owner_key: &str) -> &'a ChartStyleOwnerData {
        context
            .owners
            .iter()
            .find(|owner| owner.owner_key == owner_key)
            .unwrap_or_else(|| panic!("expected owner {owner_key}"))
    }

    fn format_solid_hex(format: &ChartFormatData) -> Option<&str> {
        match format.fill.as_ref()? {
            domain_types::chart::ChartFillData::Solid {
                color: domain_types::chart::ChartColorData::Hex(hex),
                ..
            } => Some(hex.as_str()),
            _ => None,
        }
    }

    fn diagnostic_messages(status: &ImportObjectStatus) -> Vec<&str> {
        status
            .diagnostics
            .iter()
            .filter_map(|diagnostic| diagnostic.message.as_deref())
            .collect()
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
    fn projects_chart_ex_style_context_owners() {
        let mut chart_space =
            chart_space_with_series(ChartExLayoutId::Waterfall, cat_val_dimensions(), None);
        chart_space.sp_pr = Some(solid_shape("111111"));
        chart_space.chart.title = Some(ChartExTitle {
            tx: Some(ChartExText {
                rich: Some(crate::domain::charts::parse_text_body(
                    br#"<cx:rich xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"
                               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:bodyPr/>
                        <a:p>
                            <a:r>
                                <a:rPr b="1"/>
                                <a:t>ChartEx Title</a:t>
                            </a:r>
                        </a:p>
                    </cx:rich>"#,
                )),
                ..Default::default()
            }),
            sp_pr: Some(solid_shape("333333")),
            ..Default::default()
        });
        chart_space.chart.legend = Some(ChartExLegend {
            sp_pr: Some(solid_shape("444444")),
            ..Default::default()
        });
        chart_space.chart.plot_area.sp_pr = Some(solid_shape("222222"));
        chart_space.chart.plot_area.axes = vec![
            ChartExAxis {
                scaling: Some(ChartExScaling::Category { gap_width: None }),
                title: Some(ChartExTitle {
                    tx: Some(ChartExText {
                        rich: Some(crate::domain::charts::parse_text_body(
                            br#"<cx:rich xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"
                                       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                <a:bodyPr/>
                                <a:p>
                                    <a:r>
                                        <a:rPr i="1"/>
                                        <a:t>ChartEx Axis</a:t>
                                    </a:r>
                                </a:p>
                            </cx:rich>"#,
                        )),
                        ..Default::default()
                    }),
                    sp_pr: Some(solid_shape("888888")),
                    ..Default::default()
                }),
                sp_pr: Some(solid_shape("555555")),
                ..Default::default()
            },
            ChartExAxis {
                scaling: Some(ChartExScaling::Value {
                    min: None,
                    max: None,
                }),
                sp_pr: Some(solid_shape("666666")),
                ..Default::default()
            },
        ];
        chart_space.chart.plot_area.plot_area_region.series[0].sp_pr = Some(solid_shape("777777"));

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");
        let context = projected.chart_style_context.expect("style context");

        assert_eq!(context.owners.len(), 8);
        assert_eq!(
            format_solid_hex(owner(&context, "chartArea").format.as_ref().unwrap()),
            Some("111111")
        );
        assert_eq!(
            format_solid_hex(owner(&context, "plotArea").format.as_ref().unwrap()),
            Some("222222")
        );
        assert_eq!(
            format_solid_hex(owner(&context, "title").format.as_ref().unwrap()),
            Some("333333")
        );
        assert_eq!(
            owner(&context, "title")
                .rich_text
                .as_ref()
                .and_then(|runs| runs.first())
                .map(|run| run.text.as_str()),
            Some("ChartEx Title")
        );
        assert_eq!(
            format_solid_hex(owner(&context, "legend").format.as_ref().unwrap()),
            Some("444444")
        );
        assert_eq!(
            format_solid_hex(owner(&context, "categoryAxis").format.as_ref().unwrap()),
            Some("555555")
        );
        assert_eq!(
            format_solid_hex(
                owner(&context, "categoryAxis.title")
                    .format
                    .as_ref()
                    .unwrap()
            ),
            Some("888888")
        );
        assert_eq!(
            owner(&context, "categoryAxis.title")
                .rich_text
                .as_ref()
                .and_then(|runs| runs.first())
                .map(|run| run.text.as_str()),
            Some("ChartEx Axis")
        );
        assert_eq!(
            format_solid_hex(owner(&context, "valueAxis").format.as_ref().unwrap()),
            Some("666666")
        );
        assert_eq!(
            format_solid_hex(owner(&context, "series(0)").format.as_ref().unwrap()),
            Some("777777")
        );
    }

    #[test]
    fn renderable_projection_keeps_diagnostics_for_lossy_chart_ex_fields() {
        let mut chart_space = ChartExSpace::default();
        chart_space.chart_data = ChartExChartData {
            data: vec![ChartExData {
                id: 42,
                dimensions: vec![ChartExDimension::Numeric {
                    dim_type: "val".to_string(),
                    formula: formula("Sheet1!B1:B3"),
                }],
            }],
        };
        chart_space.chart = ChartExChart {
            title: Some(ChartExTitle {
                pos: Some("l".to_string()),
                align: Some("dist".to_string()),
                overlay: Some(true),
                ..Default::default()
            }),
            legend: Some(ooxml_types::chart_ex::ChartExLegend {
                align: Some("ctr".to_string()),
                ..Default::default()
            }),
            plot_area: ChartExPlotArea {
                axes: vec![
                    ChartExAxis {
                        scaling: Some(ooxml_types::chart_ex::ChartExScaling::Category {
                            gap_width: Some("0.5".to_string()),
                        }),
                        ..Default::default()
                    },
                    ChartExAxis {
                        scaling: Some(ooxml_types::chart_ex::ChartExScaling::Category {
                            gap_width: None,
                        }),
                        ..Default::default()
                    },
                    ChartExAxis {
                        scaling: Some(ooxml_types::chart_ex::ChartExScaling::Category {
                            gap_width: None,
                        }),
                        ..Default::default()
                    },
                ],
                plot_area_region: ChartExPlotAreaRegion {
                    series: vec![ChartExSeries {
                        layout_id: ChartExLayoutId::Histogram,
                        data_id: None,
                        layout_pr: Some(ChartExLayoutProperties {
                            binning: Some(ChartExBinning {
                                interval_closed: Some("l".to_string()),
                                bin_count: Some(4),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
        };

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

        assert_eq!(projected.chart_type, ChartType::Histogram);
        assert_eq!(projected.series[0].values.as_deref(), Some("Sheet1!B1:B3"));
        let status = projected
            .import_status
            .expect("lossy-but-renderable projection should keep diagnostics");
        assert_eq!(
            status.renderability,
            domain_types::ImportRenderability::Renderable
        );
        assert_eq!(
            status.recoverability,
            domain_types::ImportRecoverability::PartiallySupported
        );
        let messages = diagnostic_messages(&status);
        for expected in [
            "no dataId",
            "title overlay",
            "title position",
            "title alignment",
            "legend alignment",
            "gapWidth",
            "Additional ChartEx category axes",
            "intervalClosed",
        ] {
            assert!(
                messages.iter().any(|message| message.contains(expected)),
                "missing diagnostic containing `{expected}` in {messages:?}"
            );
        }
    }

    #[test]
    fn internal_chart_ex_formulas_are_preserved_not_renderable_diagnostics() {
        let chart_space = chart_space_with_series(
            ChartExLayoutId::Waterfall,
            vec![
                ChartExDimension::String {
                    dim_type: "cat".to_string(),
                    formula: formula("_xlchart.CategoryCache"),
                },
                ChartExDimension::Numeric {
                    dim_type: "val".to_string(),
                    formula: formula("Sheet1!B1:B3"),
                },
            ],
            None,
        );

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");
        let status = projected
            .import_status
            .expect("internal category formulas should block waterfall rendering");

        assert_eq!(
            status.renderability,
            domain_types::ImportRenderability::NotRenderable
        );
        assert!(status.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == Some(domain_types::ImportDiagnosticCode::ChartPartMissingDataRange)
        }));
        assert!(status.diagnostics.iter().any(|diagnostic| {
            diagnostic.code == Some(domain_types::ImportDiagnosticCode::UnsupportedFeature)
                && diagnostic
                    .message
                    .as_deref()
                    .is_some_and(|message| message.contains("_xlchart.CategoryCache"))
        }));
    }

    #[test]
    fn unknown_chart_ex_dimensions_do_not_fallback_to_render_data() {
        let chart_space = chart_space_with_series(
            ChartExLayoutId::Waterfall,
            vec![
                ChartExDimension::String {
                    dim_type: "colorStr".to_string(),
                    formula: formula("Sheet1!A1:A3"),
                },
                ChartExDimension::Numeric {
                    dim_type: "colorVal".to_string(),
                    formula: formula("Sheet1!B1:B3"),
                },
            ],
            None,
        );

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");
        assert_eq!(projected.series.len(), 1);
        assert_eq!(projected.series[0].categories, None);
        assert_eq!(projected.series[0].values, None);
        assert_eq!(projected.data_range, None);
        let status = projected
            .import_status
            .expect("unknown dimensions should block rendering");

        assert_eq!(
            status.renderability,
            domain_types::ImportRenderability::NotRenderable
        );
        let messages = diagnostic_messages(&status);
        for expected in ["colorStr", "colorVal"] {
            assert!(
                messages.iter().any(|message| message.contains(expected)),
                "missing diagnostic containing `{expected}` in {messages:?}"
            );
        }
    }

    #[test]
    fn chart_ex_empty_and_non_rectangular_sources_are_not_renderable() {
        let empty = chart_ex_import_status(
            &ChartType::Waterfall,
            &[],
            None,
            "xl/charts/chartEx1.xml",
            None,
        )
        .expect("empty ChartEx series should be diagnosed");
        assert_eq!(
            empty.renderability,
            domain_types::ImportRenderability::NotRenderable
        );

        let non_rectangular = chart_ex_import_status(
            &ChartType::Waterfall,
            &[chart_series(
                ChartType::Waterfall,
                Some("Sheet1!A1:A3"),
                Some("Sheet1!C1:C2"),
            )],
            None,
            "xl/charts/chartEx1.xml",
            None,
        )
        .expect("non-rectangular ChartEx source ranges should be diagnosed");
        assert_eq!(
            non_rectangular.renderability,
            domain_types::ImportRenderability::NotRenderable
        );
    }

    #[test]
    fn projects_supported_chart_ex_family_series_data() {
        for (layout_id, expected_chart_type) in [
            (ChartExLayoutId::Funnel, ChartType::Funnel),
            (ChartExLayoutId::Histogram, ChartType::Histogram),
            (ChartExLayoutId::BoxWhisker, ChartType::Boxplot),
        ] {
            let chart_space = chart_space_with_series(layout_id, cat_val_dimensions(), None);
            let projected =
                project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

            assert_eq!(projected.chart_type, expected_chart_type);
            assert_eq!(projected.series.len(), 1);
            assert_eq!(projected.series[0].r#type, Some(expected_chart_type));
            assert_eq!(
                projected.series[0].categories.as_deref(),
                Some("Sheet1!A1:A3")
            );
            assert_eq!(projected.series[0].values.as_deref(), Some("Sheet1!B1:B3"));
            assert_eq!(projected.data_range.as_deref(), Some("Sheet1!A1:B3"));
            assert!(projected.import_status.is_none());
        }
    }

    #[test]
    fn supported_category_families_missing_categories_are_not_renderable() {
        for chart_type in [
            ChartType::Waterfall,
            ChartType::Funnel,
            ChartType::Pareto,
            ChartType::Boxplot,
        ] {
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
    fn pareto_projects_renderable_data_for_cumulative_line_renderer() {
        let chart_space =
            chart_space_with_series(ChartExLayoutId::Pareto, cat_val_dimensions(), None);
        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

        assert_eq!(projected.chart_type, ChartType::Pareto);
        assert_eq!(projected.series.len(), 1);
        assert_eq!(
            projected.series[0].categories.as_deref(),
            Some("Sheet1!A1:A3")
        );
        assert_eq!(projected.series[0].values.as_deref(), Some("Sheet1!B1:B3"));
        assert!(projected.import_status.is_none());
    }

    #[test]
    fn projects_chart_ex_data_labels_to_chart_and_series_contracts() {
        let mut chart_space =
            chart_space_with_series(ChartExLayoutId::Funnel, cat_val_dimensions(), None);
        chart_space.chart.plot_area.plot_area_region.series[0].data_labels =
            Some(ChartExDataLabels {
                pos: Some("outEnd".to_string()),
                visibility: Some(ChartExDataLabelVisibility {
                    series_name: Some(false),
                    category_name: Some(true),
                    value: Some(true),
                }),
                num_fmt: Some(ChartExNumberFormat {
                    format_code: "#,##0".to_string(),
                    source_linked: Some(false),
                }),
                separator: Some("; ".to_string()),
                ..Default::default()
            });

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

        let chart_labels = projected.data_labels.expect("chart-level data labels");
        assert_eq!(chart_labels.position.as_deref(), Some("outEnd"));
        assert_eq!(chart_labels.show_value, Some(true));
        assert_eq!(chart_labels.show_category_name, Some(true));
        assert_eq!(chart_labels.show_series_name, Some(false));
        assert_eq!(chart_labels.number_format.as_deref(), Some("#,##0"));
        assert_eq!(chart_labels.link_number_format, Some(false));
        assert_eq!(chart_labels.separator.as_deref(), Some("; "));

        let series_labels = projected.series[0]
            .data_labels
            .as_ref()
            .expect("series-level data labels");
        assert_eq!(series_labels.position.as_deref(), Some("outEnd"));
        assert_eq!(series_labels.show_value, Some(true));
    }

    #[test]
    fn projects_hierarchy_rows_for_treemap_and_sunburst() {
        let sheet = sheet_with_cells(vec![
            sheet_cell(0, 0, "Americas"),
            sheet_cell(1, 0, "Americas"),
            sheet_cell(0, 1, "US"),
            sheet_cell(1, 1, "CA"),
            sheet_cell(0, 2, "10"),
            sheet_cell(1, 2, "20"),
        ]);

        for (layout_id, expected_chart_type) in [
            (ChartExLayoutId::Treemap, ChartType::Treemap),
            (ChartExLayoutId::Sunburst, ChartType::Sunburst),
        ] {
            let chart_space = chart_space_with_series(
                layout_id,
                vec![
                    ChartExDimension::String {
                        dim_type: "cat".to_string(),
                        formula: formula("Sheet1!A1:A2"),
                    },
                    ChartExDimension::String {
                        dim_type: "cat".to_string(),
                        formula: formula("Sheet1!B1:B2"),
                    },
                    ChartExDimension::Numeric {
                        dim_type: "size".to_string(),
                        formula: formula("Sheet1!C1:C2"),
                    },
                ],
                Some(ChartExLayoutProperties {
                    parent_label_layout: Some("banner".to_string()),
                    ..Default::default()
                }),
            );
            let projected = project_chart_ex_space(&chart_space, &sheet, "xl/charts/chartEx1.xml");

            assert_eq!(projected.chart_type, expected_chart_type);
            let hierarchy = projected
                .hierarchy
                .expect("hierarchy data should be projected");
            assert_eq!(
                hierarchy.category_formulas,
                vec!["Sheet1!A1:A2".to_string(), "Sheet1!B1:B2".to_string()]
            );
            assert_eq!(hierarchy.value_formula.as_deref(), Some("Sheet1!C1:C2"));
            assert_eq!(hierarchy.parent_label_layout.as_deref(), Some("banner"));
            assert!(hierarchy.rows.iter().any(|row| row.id == "Americas"));
            assert!(
                hierarchy
                    .rows
                    .iter()
                    .any(|row| row.id == "Americas/US" && row.value == Some(10.0))
            );
            assert!(
                hierarchy
                    .rows
                    .iter()
                    .any(|row| row.id == "Americas/CA" && row.value == Some(20.0))
            );
            assert_eq!(
                projected.import_status.unwrap().renderability,
                domain_types::ImportRenderability::NotRenderable
            );
        }
    }

    #[test]
    fn projects_secondary_chart_ex_axes_and_title_alignment() {
        let chart_space = ChartExSpace {
            chart_data: ChartExChartData {
                data: vec![
                    ChartExData {
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
                    },
                    ChartExData {
                        id: 1,
                        dimensions: vec![
                            ChartExDimension::String {
                                dim_type: "cat".to_string(),
                                formula: formula("Sheet1!A1:A3"),
                            },
                            ChartExDimension::Numeric {
                                dim_type: "val".to_string(),
                                formula: formula("Sheet1!C1:C3"),
                            },
                        ],
                    },
                ],
            },
            chart: ChartExChart {
                title: Some(ChartExTitle {
                    pos: Some("t".to_string()),
                    align: Some("ctr".to_string()),
                    ..Default::default()
                }),
                plot_area: ChartExPlotArea {
                    plot_area_region: ChartExPlotAreaRegion {
                        series: vec![
                            ChartExSeries {
                                layout_id: ChartExLayoutId::Funnel,
                                data_id: Some(0),
                                ..Default::default()
                            },
                            ChartExSeries {
                                layout_id: ChartExLayoutId::Funnel,
                                data_id: Some(1),
                                ..Default::default()
                            },
                        ],
                        ..Default::default()
                    },
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
        assert_eq!(projected.series[0].y_axis_index, None);
        assert_eq!(projected.series[1].y_axis_index, Some(1));
    }

    #[test]
    fn plot_area_region_format_overrides_chart_ex_plot_area_format() {
        let chart_space = ChartExSpace {
            chart: ChartExChart {
                plot_area: ChartExPlotArea {
                    sp_pr: Some(solid_shape("00FF00")),
                    plot_area_region: ChartExPlotAreaRegion {
                        sp_pr: Some(solid_shape("FF0000")),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");
        let fill = projected
            .plot_format
            .as_ref()
            .and_then(|format| format.fill.as_ref())
            .expect("region plot format should be projected");
        assert_eq!(
            fill,
            &domain_types::chart::ChartFillData::Solid {
                color: domain_types::chart::ChartColorData::Hex("FF0000".to_string()),
                transparency: None,
            }
        );
        let status = projected
            .import_status
            .expect("merged plot styles should be diagnosed");
        assert!(
            diagnostic_messages(&status)
                .iter()
                .any(|message| message.contains("plotArea and plotAreaRegion styles")),
            "missing merged-style diagnostic"
        );
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

    #[test]
    fn projects_region_map_source_formulas_while_marking_rendering_unsupported() {
        let chart_space =
            chart_space_with_series(ChartExLayoutId::RegionMap, cat_val_dimensions(), None);

        let projected =
            project_chart_ex_space(&chart_space, &full_sheet(), "xl/charts/chartEx1.xml");

        assert_eq!(projected.chart_type, ChartType::RegionMap);
        assert_eq!(projected.data_range.as_deref(), Some("Sheet1!A1:B3"));
        assert_eq!(
            projected.region_map,
            Some(RegionMapConfigData {
                region_formula: Some("Sheet1!A1:A3".to_string()),
                value_formula: Some("Sheet1!B1:B3".to_string()),
            })
        );
        assert_eq!(
            projected.import_status.unwrap().renderability,
            domain_types::ImportRenderability::NotRenderable
        );
    }
}
