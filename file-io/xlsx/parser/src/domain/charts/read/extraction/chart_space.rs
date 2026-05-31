use super::axes::extract_axes_from_chart_space;
use super::common::{
    chart_import_status_for_renderability, chart_import_status_for_surface_family,
    chart_import_status_for_unsupported_chart_type, map_ooxml_chart_type_to_domain,
    merge_chart_import_statuses,
};
use super::data_refs::reconstruct_data_range_from_chart_space;
use super::formatting::{
    extract_chart_format, extract_chart_line, extract_chart_rich_text, extract_title_chart_format,
};
use super::labels::extract_data_label_data;
use super::legend::extract_legend_from_chart_space;
use super::series::extract_series_from_chart_space;
use super::text::extract_title_text_from_title;

pub fn extract_chart_spec_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
    anchor: &super::super::xml_parsing::ChartRefInfo,
) -> domain_types::ChartSpec {
    use domain_types::chart::{AnchorPosition, ObjectSize};

    let chart = &cs.chart;
    let plot_area = &chart.plot_area;

    // -------------------------------------------------------------------------
    // (a) chart_type - combo only when chart groups represent distinct families
    // -------------------------------------------------------------------------
    let first_group = plot_area.chart_groups.first();
    let chart_type = chart_type_for_plot_area(plot_area);

    // -------------------------------------------------------------------------
    // (b) sub_type — from first chart group's config grouping
    // -------------------------------------------------------------------------
    let sub_type = extract_stock_sub_type_from_plot_area(plot_area)
        .or_else(|| first_group.and_then(|g| extract_sub_type_from_config(&g.config)));

    // -------------------------------------------------------------------------
    // (c) title — from cs.chart.title
    // -------------------------------------------------------------------------
    let title = extract_chart_title_text(chart);

    // -------------------------------------------------------------------------
    // (d) series — from all chart groups
    // -------------------------------------------------------------------------
    let series = extract_series_from_chart_space(cs);

    // -------------------------------------------------------------------------
    // (e) legend — from cs.chart.legend
    // -------------------------------------------------------------------------
    let legend = extract_legend_from_chart_space(cs);

    // -------------------------------------------------------------------------
    // (f) axes — from cs.chart.plot_area.axes
    // -------------------------------------------------------------------------
    let axes = extract_axes_from_chart_space(cs);

    // -------------------------------------------------------------------------
    // (g) chart-level data_labels — from first chart group's d_lbls
    // -------------------------------------------------------------------------
    let data_labels = first_group
        .and_then(|g| g.d_lbls.as_ref())
        .map(|dl| extract_data_label_data(dl));

    // -------------------------------------------------------------------------
    // (h) formatting — chart-level, plot-area, title
    // -------------------------------------------------------------------------
    let chart_format = extract_chart_format(cs.sp_pr.as_ref(), cs.tx_pr.as_ref());
    let plot_format = extract_chart_format(plot_area.sp_pr.as_ref(), None);
    let title_format = chart.title.as_ref().and_then(extract_title_chart_format);
    let title_rich_text = chart.title.as_ref().and_then(extract_title_rich_text);
    let plot_layout = plot_area.layout.as_ref().map(Into::into);
    let title_layout = chart
        .title
        .as_ref()
        .and_then(|title| title.layout.as_ref().map(Into::into));

    // -------------------------------------------------------------------------
    // (i) scalar fields from first chart group's config
    // -------------------------------------------------------------------------
    let scalar_fields = first_group
        .map(|g| extract_scalar_fields_from_config(&g.config))
        .unwrap_or_default();
    let surface_family = surface_family_for_plot_area(plot_area);
    let (drop_lines, high_low_lines, series_lines, up_down_bars) = first_group
        .map(|g| extract_analysis_fields_from_config(&g.config))
        .unwrap_or_default();

    // -------------------------------------------------------------------------
    // (j) 3D view + surfaces
    // -------------------------------------------------------------------------
    let view_3d = chart
        .view_3d
        .as_ref()
        .map(|v| domain_types::chart::ChartView3DData {
            rot_x: v.rot_x.map(|x| x as i32),
            rot_y: v.rot_y.map(|y| y as i32),
            depth_percent: v.depth_percent.map(|d| d as u32),
            r_ang_ax: v.right_angle_axes,
            perspective: v.perspective.map(|p| p as u32),
            height_percent: v.height_percent.map(|h| h as u32),
        });
    let floor_format = chart
        .floor
        .as_ref()
        .and_then(|s| extract_chart_format(s.sp_pr.as_ref(), None));
    let side_wall_format = chart
        .side_wall
        .as_ref()
        .and_then(|s| extract_chart_format(s.sp_pr.as_ref(), None));
    let back_wall_format = chart
        .back_wall
        .as_ref()
        .and_then(|s| extract_chart_format(s.sp_pr.as_ref(), None));
    let pivot_options = pivot_chart_options_from_chart(chart);

    // -------------------------------------------------------------------------
    // data_table
    // -------------------------------------------------------------------------
    let data_table = plot_area
        .d_table
        .as_ref()
        .map(|dt| domain_types::chart::ChartDataTableData {
            show_horz_border: dt.show_horz_border,
            show_vert_border: dt.show_vert_border,
            show_outline: dt.show_outline,
            show_keys: dt.show_keys,
            format: extract_chart_format(dt.sp_pr.as_ref(), dt.tx_pr.as_ref()),
            show_legend_key: None,
            visible: None,
        });

    // -------------------------------------------------------------------------
    // data_range — reconstructed from series formulas
    // -------------------------------------------------------------------------
    let data_range = reconstruct_data_range_from_chart_space(cs);

    // -------------------------------------------------------------------------
    // display_blanks_as, plot_visible_only
    // -------------------------------------------------------------------------
    let display_blanks_as = chart.disp_blanks_as.map(|d| d.to_ooxml().to_string());
    let plot_visible_only = chart.plot_vis_only;
    let chart_style_context = extract_chart_style_context(ChartStyleContextInputs {
        cs,
        chart_format: chart_format.as_ref(),
        plot_format: plot_format.as_ref(),
        title_format: title_format.as_ref(),
        title_rich_text: title_rich_text.as_deref(),
        legend: legend.as_ref(),
        axes: axes.as_ref(),
        series: &series,
    });
    let renderability_import_status = match &chart_type {
        domain_types::ChartType::Unknown(raw) => chart_import_status_for_unsupported_chart_type(
            raw,
            Some(anchor.target.as_str()),
            anchor.cnv_pr_name.as_deref(),
        )
        .or_else(|| {
            chart_import_status_for_renderability(
                &series,
                data_range.as_deref(),
                Some(anchor.target.as_str()),
                anchor.cnv_pr_name.as_deref(),
            )
        }),
        _ => chart_import_status_for_renderability(
            &series,
            data_range.as_deref(),
            Some(anchor.target.as_str()),
            anchor.cnv_pr_name.as_deref(),
        ),
    };
    let surface_import_status =
        surface_family
            .as_ref()
            .and_then(|(surface_chart_type, wireframe, surface_top_view)| {
                chart_import_status_for_surface_family(
                    surface_chart_type,
                    *wireframe,
                    *surface_top_view,
                    Some(anchor.target.as_str()),
                    anchor.cnv_pr_name.as_deref(),
                )
            });
    let import_status =
        merge_chart_import_statuses(surface_import_status, renderability_import_status);

    // -------------------------------------------------------------------------
    // (l) Anchor metadata
    // -------------------------------------------------------------------------
    let width_px = (anchor.cx / 9525).max(100) as f64;
    let height_px = (anchor.cy / 9525).max(100) as f64;

    domain_types::ChartSpec {
        chart_type,
        title,
        position: AnchorPosition {
            anchor_row: anchor.from_row,
            anchor_col: anchor.from_col,
            anchor_row_offset: anchor.from_row_off,
            anchor_col_offset: anchor.from_col_off,
            absolute_x: anchor.absolute_x,
            absolute_y: anchor.absolute_y,
            end_row: anchor.to_row,
            end_col: anchor.to_col,
            end_row_offset: anchor.to_row_off,
            end_col_offset: anchor.to_col_off,
            extent_cx: if anchor.to_row.is_none() && anchor.cx > 0 {
                Some(anchor.cx)
            } else {
                None
            },
            extent_cy: if anchor.to_row.is_none() && anchor.cy > 0 {
                Some(anchor.cy)
            } else {
                None
            },
        },
        size: ObjectSize {
            width: width_px,
            height: height_px,
            ..Default::default()
        },
        z_index: 0,
        definition: Some(domain_types::ChartDefinition::Chart(cs.clone())),
        series,
        sub_type,
        legend,
        axes,
        data_labels,
        data_range,
        style: cs.style,
        rounded_corners: cs.rounded_corners,
        auto_title_deleted: chart.auto_title_deleted,
        show_data_labels_over_max: chart.show_d_lbls_over_max,
        chart_format,
        plot_format,
        title_format,
        title_rich_text,
        title_formula: None,
        plot_layout,
        title_layout,
        data_table,
        drop_lines,
        high_low_lines,
        series_lines,
        up_down_bars,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
        display_blanks_as,
        plot_visible_only,
        gap_width: scalar_fields.gap_width,
        gap_depth: scalar_fields.gap_depth,
        overlap: scalar_fields.overlap,
        doughnut_hole_size: scalar_fields.doughnut_hole_size,
        first_slice_angle: scalar_fields.first_slice_angle,
        bubble_scale: scalar_fields.bubble_scale,
        show_neg_bubbles: scalar_fields.show_neg_bubbles,
        size_represents: scalar_fields.size_represents,
        split_type: scalar_fields.split_type,
        split_value: scalar_fields.split_value,
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: chart.show_all_field_buttons,
        second_plot_size: None,
        vary_by_categories: scalar_fields.vary_by_categories,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options,
        pivot_projection: None,
        bar_shape: scalar_fields.bar_shape,
        bubble_3d_effect: scalar_fields.bubble_3d_effect,
        wireframe: scalar_fields.wireframe,
        surface_top_view: scalar_fields.surface_top_view,
        color_scheme: None,
        chart_style_context,
        view_3d,
        floor_format,
        side_wall_format,
        back_wall_format,
        chart_frame: None,
        chart_relationships: Vec::new(),
        chart_auxiliary_files: Vec::new(),
        chart_auxiliary_parts: Vec::new(),
        chart_ex_replay: None,
        standard_chart_provenance: None,
        standard_chart_export_authority: None,
        is_chart_ex: false,
        cnv_pr_name: anchor.cnv_pr_name.clone(),
        cnv_pr_id: anchor.cnv_pr_id,
        cnv_pr_descr: anchor.cnv_pr_descr.clone(),
        cnv_pr_title: anchor.cnv_pr_title.clone(),
        cnv_pr_hidden: anchor.cnv_pr_hidden,
        no_change_aspect: anchor.no_change_aspect,
        has_graphic_frame_locks: anchor.has_graphic_frame_locks,
        xfrm_off_x: anchor.xfrm_off_x,
        xfrm_off_y: anchor.xfrm_off_y,
        xfrm_ext_cx: anchor.xfrm_ext_cx,
        xfrm_ext_cy: anchor.xfrm_ext_cy,
        cnv_pr_ext_lst: anchor.cnv_pr_ext_lst.clone(),
        anchor_edit_as: anchor.anchor_edit_as.clone(),
        macro_name: anchor.macro_name.clone(),
        client_data_locks_with_sheet: anchor.client_data_locks_with_sheet,
        client_data_prints_with_sheet: anchor.client_data_prints_with_sheet,
        anchor_index: anchor.anchor_index,
        import_status,
    }
}

fn extract_analysis_fields_from_config(
    config: &ooxml_types::charts::ChartTypeConfig,
) -> (
    Option<domain_types::chart::ChartLineSettingsData>,
    Option<domain_types::chart::ChartLineSettingsData>,
    Option<domain_types::chart::ChartLineSettingsData>,
    Option<domain_types::chart::UpDownBarsData>,
) {
    use ooxml_types::charts::ChartTypeConfig;

    match config {
        ChartTypeConfig::Bar(cfg) => (
            None,
            None,
            cfg.ser_lines.first().map(extract_chart_line_settings),
            None,
        ),
        ChartTypeConfig::Line(cfg) => (
            cfg.drop_lines.as_ref().map(extract_chart_line_settings),
            cfg.hi_low_lines.as_ref().map(extract_chart_line_settings),
            None,
            cfg.up_down_bars.as_ref().map(extract_up_down_bars_data),
        ),
        ChartTypeConfig::Line3D(cfg) => (
            cfg.drop_lines.as_ref().map(extract_chart_line_settings),
            None,
            None,
            None,
        ),
        ChartTypeConfig::Area(cfg) => (
            cfg.drop_lines.as_ref().map(extract_chart_line_settings),
            None,
            None,
            None,
        ),
        ChartTypeConfig::Area3D(cfg) => (
            cfg.drop_lines.as_ref().map(extract_chart_line_settings),
            None,
            None,
            None,
        ),
        ChartTypeConfig::Stock(cfg) => (
            cfg.drop_lines.as_ref().map(extract_chart_line_settings),
            cfg.hi_low_lines.as_ref().map(extract_chart_line_settings),
            None,
            cfg.up_down_bars.as_ref().map(extract_up_down_bars_data),
        ),
        ChartTypeConfig::OfPie(cfg) => (
            None,
            None,
            cfg.ser_lines.first().map(extract_chart_line_settings),
            None,
        ),
        _ => Default::default(),
    }
}

fn extract_chart_line_settings(
    lines: &ooxml_types::charts::ChartLines,
) -> domain_types::chart::ChartLineSettingsData {
    domain_types::chart::ChartLineSettingsData {
        visible: Some(true),
        format: lines
            .sp_pr
            .as_ref()
            .and_then(|sp_pr| sp_pr.ln.as_ref())
            .map(extract_chart_line),
    }
}

fn extract_up_down_bars_data(
    bars: &ooxml_types::charts::UpDownBars,
) -> domain_types::chart::UpDownBarsData {
    domain_types::chart::UpDownBarsData {
        gap_width: bars.gap_width,
        up_format: bars
            .up_bars
            .as_ref()
            .and_then(|sp_pr| extract_chart_format(Some(sp_pr), None)),
        down_format: bars
            .down_bars
            .as_ref()
            .and_then(|sp_pr| extract_chart_format(Some(sp_pr), None)),
    }
}

// =============================================================================
// Helpers for the new ChartSpace -> ChartSpec pipeline
// =============================================================================

fn chart_type_for_plot_area(plot_area: &ooxml_types::charts::PlotArea) -> domain_types::ChartType {
    let mut groups = plot_area.chart_groups.iter();
    let Some(first_group) = groups.next() else {
        return domain_types::ChartType::Unknown(String::new());
    };

    let first_type = chart_type_for_group(first_group);
    if groups.any(|group| chart_type_for_group(group) != first_type) {
        domain_types::ChartType::Combo
    } else {
        first_type
    }
}

fn surface_family_for_plot_area(
    plot_area: &ooxml_types::charts::PlotArea,
) -> Option<(domain_types::ChartType, Option<bool>, Option<bool>)> {
    plot_area.chart_groups.iter().find_map(|group| {
        let chart_type = chart_type_for_group(group);
        if !matches!(
            chart_type,
            domain_types::ChartType::Surface | domain_types::ChartType::Surface3D
        ) {
            return None;
        }

        let fields = extract_scalar_fields_from_config(&group.config);
        Some((chart_type, fields.wireframe, fields.surface_top_view))
    })
}

fn chart_type_for_group(group: &ooxml_types::charts::ChartGroup) -> domain_types::ChartType {
    if group.chart_type == ooxml_types::charts::ChartType::Unknown {
        if let Some(token) = group.raw_chart_element_name.as_deref() {
            return domain_types::ChartType::Unknown(token.to_string());
        }
    }

    map_ooxml_chart_type_to_domain(group.chart_type, &group.config)
}

fn extract_chart_title_text(chart: &ooxml_types::charts::Chart) -> Option<String> {
    if let Some(title) = chart
        .title
        .as_ref()
        .and_then(|t| extract_title_text_from_title(t))
        .filter(|text| !text.trim().is_empty())
    {
        return Some(title);
    }

    if chart.title.is_some() && chart.auto_title_deleted != Some(true) {
        return Some("Chart Title".to_string());
    }

    None
}

fn extract_title_rich_text(
    title: &ooxml_types::charts::Title,
) -> Option<Vec<domain_types::chart::ChartFormatStringData>> {
    match title.tx.as_ref()? {
        ooxml_types::charts::ChartText::Rich(body) => extract_chart_rich_text(body),
        ooxml_types::charts::ChartText::StrRef(_) => None,
    }
}

fn pivot_chart_options_from_chart(
    chart: &ooxml_types::charts::Chart,
) -> Option<domain_types::chart::PivotChartOptionsData> {
    let options = domain_types::chart::PivotChartOptionsData {
        show_axis_field_buttons: chart.show_axis_field_buttons,
        show_legend_field_buttons: chart.show_legend_field_buttons,
        show_report_filter_field_buttons: chart.show_report_filter_field_buttons,
        show_value_field_buttons: chart.show_value_field_buttons,
    };
    (options.show_axis_field_buttons.is_some()
        || options.show_legend_field_buttons.is_some()
        || options.show_report_filter_field_buttons.is_some()
        || options.show_value_field_buttons.is_some())
    .then_some(options)
}

struct ChartStyleContextInputs<'a> {
    cs: &'a ooxml_types::charts::ChartSpace,
    chart_format: Option<&'a domain_types::chart::ChartFormatData>,
    plot_format: Option<&'a domain_types::chart::ChartFormatData>,
    title_format: Option<&'a domain_types::chart::ChartFormatData>,
    title_rich_text: Option<&'a [domain_types::chart::ChartFormatStringData]>,
    legend: Option<&'a domain_types::chart::LegendData>,
    axes: Option<&'a domain_types::chart::AxisData>,
    series: &'a [domain_types::chart::ChartSeriesData],
}

fn extract_chart_style_context(
    inputs: ChartStyleContextInputs<'_>,
) -> Option<domain_types::ChartStyleContextData> {
    let mut context = domain_types::ChartStyleContextData {
        color_map_override: inputs.cs.clr_map_ovr.as_ref().map(Into::into),
        ..Default::default()
    };

    push_style_owner(
        &mut context.owners,
        "chartArea",
        "c:chartSpace/c:spPr|c:chartSpace/c:txPr",
        inputs.chart_format,
        None,
    );
    push_style_owner(
        &mut context.owners,
        "plotArea",
        "c:chartSpace/c:chart/c:plotArea/c:spPr",
        inputs.plot_format,
        None,
    );
    push_style_owner(
        &mut context.owners,
        "title",
        "c:chartSpace/c:chart/c:title",
        inputs.title_format,
        inputs.title_rich_text,
    );

    if let Some(legend) = inputs.legend {
        push_style_owner(
            &mut context.owners,
            "legend",
            "c:chartSpace/c:chart/c:legend",
            legend.format.as_ref(),
            None,
        );
    }

    if let Some(axes) = inputs.axes {
        push_axis_style_owner(
            &mut context.owners,
            "categoryAxis",
            "c:chartSpace/c:chart/c:plotArea/c:catAx|c:dateAx",
            axes.category_axis.as_ref(),
        );
        push_axis_style_owner(
            &mut context.owners,
            "valueAxis",
            "c:chartSpace/c:chart/c:plotArea/c:valAx",
            axes.value_axis.as_ref(),
        );
        push_axis_style_owner(
            &mut context.owners,
            "secondaryCategoryAxis",
            "c:chartSpace/c:chart/c:plotArea/c:catAx[secondary]|c:dateAx[secondary]",
            axes.secondary_category_axis.as_ref(),
        );
        push_axis_style_owner(
            &mut context.owners,
            "secondaryValueAxis",
            "c:chartSpace/c:chart/c:plotArea/c:valAx[secondary]",
            axes.secondary_value_axis.as_ref(),
        );
        push_axis_style_owner(
            &mut context.owners,
            "seriesAxis",
            "c:chartSpace/c:chart/c:plotArea/c:serAx",
            axes.series_axis.as_ref(),
        );
    }

    for (index, series) in inputs.series.iter().enumerate() {
        let owner_key = series_owner_key(index, series);
        let source_path = series_source_path(series);
        push_style_owner(
            &mut context.owners,
            &owner_key,
            &source_path,
            series.format.as_ref(),
            None,
        );
    }

    if context.color_map_override.is_none()
        && context.diagnostics.is_empty()
        && context.owners.is_empty()
    {
        None
    } else {
        Some(context)
    }
}

fn push_axis_style_owner(
    owners: &mut Vec<domain_types::ChartStyleOwnerData>,
    owner_key: &str,
    source_path: &str,
    axis: Option<&domain_types::chart::SingleAxisData>,
) {
    let Some(axis) = axis else {
        return;
    };

    push_style_owner(owners, owner_key, source_path, axis.format.as_ref(), None);
    push_style_owner(
        owners,
        &format!("{owner_key}.title"),
        &format!("{source_path}/c:title"),
        axis.title_format.as_ref(),
        axis.title_rich_text.as_deref(),
    );
}

fn series_owner_key(index: usize, series: &domain_types::chart::ChartSeriesData) -> String {
    match (series.idx, series.order) {
        (Some(idx), Some(order)) => format!("series(idx={idx},order={order})"),
        (Some(idx), None) => format!("series(idx={idx})"),
        (None, Some(order)) => format!("series(order={order})"),
        (None, None) => format!("series({index})"),
    }
}

fn series_source_path(series: &domain_types::chart::ChartSeriesData) -> String {
    match series.idx {
        Some(idx) => format!("c:chartSpace/c:chart/c:plotArea/*/c:ser[c:idx={idx}]"),
        None => "c:chartSpace/c:chart/c:plotArea/*/c:ser".to_string(),
    }
}

fn push_style_owner(
    owners: &mut Vec<domain_types::ChartStyleOwnerData>,
    owner_key: &str,
    source_path: &str,
    format: Option<&domain_types::chart::ChartFormatData>,
    rich_text: Option<&[domain_types::chart::ChartFormatStringData]>,
) {
    let rich_text = rich_text
        .filter(|runs| !runs.is_empty())
        .map(|runs| runs.to_vec());

    if format.is_none() && rich_text.is_none() {
        return;
    }

    owners.push(domain_types::ChartStyleOwnerData {
        owner_key: owner_key.to_string(),
        source_path: Some(source_path.to_string()),
        edit_owner_id: None,
        format: format.cloned(),
        rich_text,
        diagnostics: Vec::new(),
        imported_drawing_ml: None,
    });
}

/// Extract sub-type from a chart type config.
fn extract_sub_type_from_config(
    config: &ooxml_types::charts::ChartTypeConfig,
) -> Option<domain_types::chart::ChartSubType> {
    use ooxml_types::charts::{ChartTypeConfig as CTC, Grouping};

    let grouping = match config {
        CTC::Bar(c) => c.grouping.as_ref(),
        CTC::Bar3D(c) => c.grouping.as_ref(),
        CTC::Line(c) => Some(&c.grouping),
        CTC::Line3D(c) => Some(&c.grouping),
        CTC::Area(c) => c.grouping.as_ref(),
        CTC::Area3D(c) => c.grouping.as_ref(),
        _ => None,
    }?;

    match grouping {
        Grouping::Clustered => Some(domain_types::chart::ChartSubType::Clustered),
        Grouping::Stacked => Some(domain_types::chart::ChartSubType::Stacked),
        Grouping::PercentStacked => Some(domain_types::chart::ChartSubType::PercentStacked),
        Grouping::Standard => None, // Default, don't emit
    }
}

fn extract_stock_sub_type_from_plot_area(
    plot_area: &ooxml_types::charts::PlotArea,
) -> Option<domain_types::chart::ChartSubType> {
    use domain_types::chart::ChartSubType;

    let mut stock_series_count = None;
    let mut volume_series_count = 0usize;

    for group in &plot_area.chart_groups {
        if is_stock_group(group) {
            if stock_series_count.is_some() {
                return None;
            }
            stock_series_count = Some(group.series.len());
        } else if is_stock_volume_group(group) {
            volume_series_count += group.series.len();
        } else {
            return None;
        }
    }

    match (stock_series_count?, volume_series_count) {
        (3, 0) => Some(ChartSubType::Hlc),
        (4, 0) => Some(ChartSubType::Ohlc),
        (3, 1) => Some(ChartSubType::VolumeHlc),
        (4, 1) => Some(ChartSubType::VolumeOhlc),
        _ => None,
    }
}

fn is_stock_group(group: &ooxml_types::charts::ChartGroup) -> bool {
    matches!(&group.config, ooxml_types::charts::ChartTypeConfig::Stock(_))
        || group.chart_type == ooxml_types::charts::ChartType::Stock
}

fn is_stock_volume_group(group: &ooxml_types::charts::ChartGroup) -> bool {
    matches!(
        group.chart_type,
        ooxml_types::charts::ChartType::Bar | ooxml_types::charts::ChartType::Bar3D
    ) && matches!(
        &group.config,
        ooxml_types::charts::ChartTypeConfig::Bar(_)
            | ooxml_types::charts::ChartTypeConfig::Bar3D(_)
    )
}

#[derive(Default)]
struct ScalarChartFields {
    gap_width: Option<u32>,
    gap_depth: Option<u32>,
    overlap: Option<i32>,
    doughnut_hole_size: Option<u32>,
    first_slice_angle: Option<u32>,
    bubble_scale: Option<u32>,
    show_neg_bubbles: Option<bool>,
    size_represents: Option<String>,
    bubble_3d_effect: Option<bool>,
    split_type: Option<String>,
    split_value: Option<f64>,
    bar_shape: Option<String>,
    wireframe: Option<bool>,
    surface_top_view: Option<bool>,
    vary_by_categories: Option<bool>,
}

fn extract_scalar_fields_from_config(
    config: &ooxml_types::charts::ChartTypeConfig,
) -> ScalarChartFields {
    use ooxml_types::charts::ChartTypeConfig as CTC;

    match config {
        CTC::Bar(c) => ScalarChartFields {
            gap_width: c.gap_width,
            overlap: c.overlap,
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Bar3D(c) => ScalarChartFields {
            gap_width: c.gap_width,
            gap_depth: c.gap_depth,
            bar_shape: c.shape.map(|shape| shape.to_ooxml().to_string()),
            wireframe: None,
            surface_top_view: None,
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Line(c) => ScalarChartFields {
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Line3D(c) => ScalarChartFields {
            gap_depth: c.gap_depth,
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Surface(c) => ScalarChartFields {
            wireframe: c.wireframe,
            surface_top_view: Some(true),
            ..Default::default()
        },
        CTC::Surface3D(c) => ScalarChartFields {
            wireframe: c.wireframe,
            surface_top_view: Some(false),
            ..Default::default()
        },
        CTC::Pie(c) => ScalarChartFields {
            first_slice_angle: c.first_slice_ang,
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Pie3D(c) => ScalarChartFields {
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Doughnut(c) => ScalarChartFields {
            doughnut_hole_size: c.hole_size,
            first_slice_angle: c.first_slice_ang,
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Area(c) => ScalarChartFields {
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Area3D(c) => ScalarChartFields {
            gap_depth: c.gap_depth,
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Scatter(c) => ScalarChartFields {
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Bubble(c) => ScalarChartFields {
            bubble_scale: c.bubble_scale,
            show_neg_bubbles: c.show_neg_bubbles,
            size_represents: c.size_represents.map(|sr| sr.to_ooxml().to_string()),
            bubble_3d_effect: c.bubble_3d,
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::Radar(c) => ScalarChartFields {
            vary_by_categories: c.vary_colors,
            ..Default::default()
        },
        CTC::OfPie(c) => {
            let split_type = c.split_type.map(|st| st.to_ooxml().to_string());
            let split_value = c.split_pos;
            ScalarChartFields {
                gap_width: c.gap_width,
                split_type,
                split_value,
                vary_by_categories: c.vary_colors,
                ..Default::default()
            }
        }
        _ => ScalarChartFields::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::charts::{
        AreaChartConfig, AxisType, BarChartConfig, Chart as OoxmlChart, ChartAxis,
        ChartAxisPosition, ChartGroup, ChartSeries, ChartSpace, ChartText, ChartType,
        ChartTypeConfig, Legend, LineChartConfig, PlotArea, StockChartConfig, Title,
    };

    fn chart_anchor() -> crate::domain::charts::read::xml_parsing::ChartRefInfo {
        crate::domain::charts::read::xml_parsing::ChartRefInfo {
            target: "charts/chart1.xml".to_string(),
            from_row: 0,
            from_col: 0,
            from_col_off: 0,
            from_row_off: 0,
            absolute_x: None,
            absolute_y: None,
            to_row: None,
            to_col: None,
            to_col_off: None,
            to_row_off: None,
            cx: 600 * 9525,
            cy: 400 * 9525,
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 600 * 9525,
            xfrm_ext_cy: 400 * 9525,
            cnv_pr_name: Some("Chart 1".to_string()),
            cnv_pr_id: Some(1),
            cnv_pr_descr: None,
            cnv_pr_title: None,
            cnv_pr_hidden: false,
            no_change_aspect: None,
            has_graphic_frame_locks: false,
            cnv_pr_ext_lst: None,
            anchor_edit_as: None,
            macro_name: None,
            client_data_locks_with_sheet: None,
            client_data_prints_with_sheet: None,
            anchor_index: Some(0),
        }
    }

    fn group(chart_type: ChartType, config: ChartTypeConfig) -> ChartGroup {
        ChartGroup {
            chart_type,
            config,
            series: Vec::new(),
            d_lbls: None,
            ax_id: Vec::new(),
            raw_chart_type_attr: None,
            raw_chart_element_name: None,
            raw_chart_group_xml: None,
        }
    }

    fn group_with_series(
        chart_type: ChartType,
        config: ChartTypeConfig,
        series_count: usize,
    ) -> ChartGroup {
        ChartGroup {
            series: (0..series_count)
                .map(|idx| ChartSeries {
                    idx: idx as u32,
                    order: idx as u32,
                    ..Default::default()
                })
                .collect(),
            ..group(chart_type, config)
        }
    }

    fn stock_group(series_count: usize) -> ChartGroup {
        group_with_series(
            ChartType::Stock,
            ChartTypeConfig::Stock(StockChartConfig::default()),
            series_count,
        )
    }

    fn volume_group(series_count: usize) -> ChartGroup {
        group_with_series(
            ChartType::Bar,
            ChartTypeConfig::Bar(BarChartConfig::default()),
            series_count,
        )
    }

    fn unknown_group(raw_element_name: &str) -> ChartGroup {
        ChartGroup {
            chart_type: ChartType::Unknown,
            config: ChartTypeConfig::Combo,
            series: Vec::new(),
            d_lbls: None,
            ax_id: Vec::new(),
            raw_chart_type_attr: None,
            raw_chart_element_name: Some(raw_element_name.to_string()),
            raw_chart_group_xml: Some(format!("<c:{raw_element_name}/>")),
        }
    }

    fn owner<'a>(
        context: &'a domain_types::ChartStyleContextData,
        owner_key: &str,
    ) -> &'a domain_types::ChartStyleOwnerData {
        context
            .owners
            .iter()
            .find(|owner| owner.owner_key == owner_key)
            .unwrap_or_else(|| panic!("expected owner {owner_key}"))
    }

    fn solid_fill_sp_pr(hex: &str) -> ooxml_types::charts::ShapeProperties {
        let xml = format!(
            r#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:solidFill><a:srgbClr val="{hex}"/></a:solidFill>
            </c:spPr>"#
        );
        crate::domain::charts::parse_shape_properties(xml.as_bytes())
    }

    fn tx_pr_with_font_size(size: u32) -> ooxml_types::drawings::TextBody {
        let xml = format!(
            r#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:pPr><a:defRPr sz="{size}"/></a:pPr>
                </a:p>
            </c:txPr>"#
        );
        crate::domain::charts::parse_text_body(xml.as_bytes())
    }

    fn format_solid_hex(format: &domain_types::chart::ChartFormatData) -> Option<&str> {
        match format.fill.as_ref()? {
            domain_types::chart::ChartFillData::Solid {
                color: domain_types::chart::ChartColorData::Hex(hex),
                ..
            } => Some(hex.as_str()),
            _ => None,
        }
    }

    #[test]
    fn repeated_chart_groups_keep_their_single_chart_family() {
        let plot_area = PlotArea {
            chart_groups: vec![
                group(
                    ChartType::Line,
                    ChartTypeConfig::Line(LineChartConfig::default()),
                ),
                group(
                    ChartType::Line,
                    ChartTypeConfig::Line(LineChartConfig::default()),
                ),
            ],
            ..Default::default()
        };

        assert_eq!(
            chart_type_for_plot_area(&plot_area),
            domain_types::ChartType::Line
        );
    }

    #[test]
    fn distinct_chart_group_families_become_combo() {
        let plot_area = PlotArea {
            chart_groups: vec![
                group(
                    ChartType::Area,
                    ChartTypeConfig::Area(AreaChartConfig::default()),
                ),
                group(
                    ChartType::Line,
                    ChartTypeConfig::Line(LineChartConfig::default()),
                ),
            ],
            ..Default::default()
        };

        assert_eq!(
            chart_type_for_plot_area(&plot_area),
            domain_types::ChartType::Combo
        );
    }

    #[test]
    fn stock_series_count_sets_hlc_and_ohlc_subtypes() {
        for (series_count, expected) in [
            (3, domain_types::chart::ChartSubType::Hlc),
            (4, domain_types::chart::ChartSubType::Ohlc),
        ] {
            let cs = ChartSpace {
                chart: OoxmlChart {
                    plot_area: PlotArea {
                        chart_groups: vec![stock_group(series_count)],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ..Default::default()
            };

            let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());

            assert_eq!(spec.chart_type, domain_types::ChartType::Stock);
            assert_eq!(spec.sub_type, Some(expected));
        }
    }

    #[test]
    fn stock_volume_combo_sets_volume_stock_subtype_and_series_roles() {
        let cs = ChartSpace {
            chart: OoxmlChart {
                plot_area: PlotArea {
                    chart_groups: vec![volume_group(1), stock_group(4)],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());

        assert_eq!(spec.chart_type, domain_types::ChartType::Combo);
        assert_eq!(
            spec.sub_type,
            Some(domain_types::chart::ChartSubType::VolumeOhlc)
        );
        assert_eq!(spec.series.len(), 5);
        assert_eq!(spec.series[0].r#type, Some(domain_types::ChartType::Column));
        assert!(
            spec.series[1..]
                .iter()
                .all(|series| series.r#type == Some(domain_types::ChartType::Stock))
        );
    }

    #[test]
    fn unknown_standard_chart_group_preserves_raw_token_and_status() {
        let cs = ChartSpace {
            chart: OoxmlChart {
                plot_area: PlotArea {
                    chart_groups: vec![unknown_group("fooChart")],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());

        assert_eq!(
            spec.chart_type,
            domain_types::ChartType::Unknown("fooChart".to_string())
        );
        let status = spec.import_status.expect("unsupported chart status");
        assert_eq!(
            status.recoverability,
            domain_types::ImportRecoverability::PreservedNotRenderable
        );
        assert_eq!(
            status.renderability,
            domain_types::ImportRenderability::NotRenderable
        );
        let diagnostic = status.diagnostics.first().expect("diagnostic ref");
        assert_eq!(
            diagnostic.code,
            Some(domain_types::ImportDiagnosticCode::UnsupportedChartType)
        );
        assert_eq!(
            diagnostic.message.as_deref(),
            Some("Standard chart type `fooChart` is not supported for rendering")
        );
        assert_eq!(diagnostic.part.as_deref(), Some("charts/chart1.xml"));
    }

    #[test]
    fn no_chart_groups_do_not_default_to_column() {
        let plot_area = PlotArea::default();

        assert_eq!(
            chart_type_for_plot_area(&plot_area),
            domain_types::ChartType::Unknown(String::new())
        );
    }

    #[test]
    fn empty_visible_title_imports_excel_default_chart_title() {
        let cs = ChartSpace {
            chart: OoxmlChart {
                title: Some(Title::default()),
                auto_title_deleted: Some(false),
                plot_area: PlotArea::default(),
                ..Default::default()
            },
            ..Default::default()
        };

        let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());

        assert_eq!(spec.title.as_deref(), Some("Chart Title"));
    }

    #[test]
    fn empty_deleted_title_imports_no_title() {
        let cs = ChartSpace {
            chart: OoxmlChart {
                title: Some(Title::default()),
                auto_title_deleted: Some(true),
                plot_area: PlotArea::default(),
                ..Default::default()
            },
            ..Default::default()
        };

        let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());

        assert_eq!(spec.title, None);
    }

    #[test]
    fn color_map_override_projects_to_style_context() {
        let cs = ChartSpace {
            clr_map_ovr: Some(
                ooxml_types::themes::ColorMappingOverride::OverrideClrMapping(
                    ooxml_types::themes::ColorMapping {
                        bg1: ooxml_types::themes::ColorSchemeIndex::Dk2,
                        tx1: ooxml_types::themes::ColorSchemeIndex::Accent2,
                        ..Default::default()
                    },
                ),
            ),
            ..Default::default()
        };

        let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());

        assert!(matches!(
            spec.chart_style_context
                .as_ref()
                .and_then(|context| context.color_map_override.as_ref()),
            Some(domain_types::ChartColorMapOverrideData::Override { .. })
        ));
        let Some(domain_types::ChartColorMapOverrideData::Override { mapping }) = spec
            .chart_style_context
            .as_ref()
            .and_then(|context| context.color_map_override.as_ref())
        else {
            panic!("expected override color mapping");
        };
        assert_eq!(mapping.bg1.as_deref(), Some("Dk2"));
        assert_eq!(mapping.tx1.as_deref(), Some("Accent2"));
    }

    #[test]
    fn imported_formatting_projects_to_style_context_owners() {
        let title_rich_text = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:r>
                        <a:rPr b="1"/>
                        <a:t>Owner Title</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        );
        let axis_title_rich_text = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:r>
                        <a:rPr i="1"/>
                        <a:t>Axis Title</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        );
        let cs = ChartSpace {
            sp_pr: Some(solid_fill_sp_pr("111111")),
            chart: OoxmlChart {
                title: Some(Title {
                    tx: Some(ChartText::Rich(title_rich_text)),
                    sp_pr: Some(solid_fill_sp_pr("333333")),
                    ..Default::default()
                }),
                legend: Some(Legend {
                    tx_pr: Some(tx_pr_with_font_size(900)),
                    ..Default::default()
                }),
                plot_area: PlotArea {
                    sp_pr: Some(solid_fill_sp_pr("222222")),
                    axes: vec![
                        ChartAxis {
                            axis_type: AxisType::Category,
                            ax_id: 10,
                            cross_ax: 20,
                            ax_pos: ChartAxisPosition::Bottom,
                            title: Some(Title {
                                tx: Some(ChartText::Rich(axis_title_rich_text)),
                                sp_pr: Some(solid_fill_sp_pr("666666")),
                                ..Default::default()
                            }),
                            sp_pr: Some(solid_fill_sp_pr("444444")),
                            ..Default::default()
                        },
                        ChartAxis {
                            axis_type: AxisType::Value,
                            ax_id: 20,
                            cross_ax: 10,
                            ax_pos: ChartAxisPosition::Left,
                            tx_pr: Some(tx_pr_with_font_size(1100)),
                            ..Default::default()
                        },
                    ],
                    chart_groups: vec![ChartGroup {
                        chart_type: ChartType::Line,
                        config: ChartTypeConfig::Line(LineChartConfig::default()),
                        series: vec![ChartSeries {
                            idx: 0,
                            order: 0,
                            sp_pr: Some(solid_fill_sp_pr("555555")),
                            ..Default::default()
                        }],
                        ax_id: vec![10, 20],
                        d_lbls: None,
                        raw_chart_type_attr: None,
                        raw_chart_element_name: None,
                        raw_chart_group_xml: None,
                    }],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());
        let context = spec.chart_style_context.expect("style context");

        assert_eq!(context.color_map_override, None);
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
            Some("Owner Title")
        );
        assert_eq!(
            owner(&context, "legend")
                .format
                .as_ref()
                .and_then(|format| format.font.as_ref())
                .and_then(|font| font.size),
            Some(9.0)
        );
        assert_eq!(
            format_solid_hex(owner(&context, "categoryAxis").format.as_ref().unwrap()),
            Some("444444")
        );
        assert_eq!(
            format_solid_hex(
                owner(&context, "categoryAxis.title")
                    .format
                    .as_ref()
                    .unwrap()
            ),
            Some("666666")
        );
        assert_eq!(
            owner(&context, "categoryAxis.title")
                .rich_text
                .as_ref()
                .and_then(|runs| runs.first())
                .map(|run| run.text.as_str()),
            Some("Axis Title")
        );
        assert_eq!(
            owner(&context, "valueAxis")
                .format
                .as_ref()
                .and_then(|format| format.font.as_ref())
                .and_then(|font| font.size),
            Some(11.0)
        );
        assert_eq!(
            format_solid_hex(
                owner(&context, "series(idx=0,order=0)")
                    .format
                    .as_ref()
                    .unwrap()
            ),
            Some("555555")
        );
    }

    #[test]
    fn inline_title_rich_text_runs_are_projected() {
        let body = crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:p>
                    <a:defRPr sz="1200"/>
                    <a:r>
                        <a:rPr b="1"/>
                        <a:t>Bold</a:t>
                    </a:r>
                    <a:r>
                        <a:rPr i="1"/>
                        <a:t> Italic</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        );
        let cs = ChartSpace {
            chart: OoxmlChart {
                title: Some(Title {
                    tx: Some(ChartText::Rich(body)),
                    ..Default::default()
                }),
                plot_area: PlotArea::default(),
                ..Default::default()
            },
            ..Default::default()
        };

        let spec = extract_chart_spec_from_chart_space(&cs, &chart_anchor());
        let runs = spec.title_rich_text.expect("expected rich title runs");

        assert_eq!(
            runs.iter().map(|run| run.text.as_str()).collect::<Vec<_>>(),
            vec!["Bold", " Italic"]
        );
        assert_eq!(runs[0].font.as_ref().and_then(|font| font.bold), Some(true));
        assert_eq!(
            runs[1].font.as_ref().and_then(|font| font.italic),
            Some(true)
        );
    }
}
