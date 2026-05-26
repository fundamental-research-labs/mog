//! Domain extraction functions: OOXML -> domain types.

// =============================================================================
// Typed extraction functions: OOXML -> domain types
// =============================================================================

/// Extract typed series data from all chart series.
pub(super) fn extract_chart_series(
    chart: &crate::domain::charts::Chart,
) -> Vec<domain_types::chart::ChartSeriesData> {
    use crate::domain::charts::series::SeriesTextSource;

    chart
        .series
        .iter()
        .map(|s| {
            let name = s.tx.as_ref().and_then(|tx| match tx {
                SeriesTextSource::Value(v) => Some(v.clone()),
                SeriesTextSource::StrRef(sr) => sr
                    .str_cache
                    .as_ref()
                    .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
            });

            let color = s.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));

            // Values range: val (standard) or y_val (scatter/bubble)
            let values =
                extract_num_ref_formula(&s.val).or_else(|| extract_num_ref_formula(&s.y_val));

            // Categories range: cat (standard) or x_val (scatter/bubble)
            let categories =
                extract_cat_ref_formula(&s.cat).or_else(|| extract_cat_ref_formula(&s.x_val));

            let bubble_size = extract_num_ref_formula(&s.bubble_size);

            // Markers
            let (show_markers, marker_size, marker_style) = extract_marker_config(&s.marker);

            // Per-point formatting
            let points = if s.d_pt.is_empty() {
                None
            } else {
                Some(
                    s.d_pt
                        .iter()
                        .map(|pt| {
                            let fill = pt.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));
                            domain_types::chart::PointFormatData {
                                idx: pt.idx,
                                fill,
                                border: None,
                                data_label: None,
                                visual_format: None,
                                marker_background_color: None,
                                marker_foreground_color: None,
                                marker_size: None,
                                marker_style: None,
                            }
                        })
                        .collect(),
                )
            };

            // Trendlines
            let trendlines = if s.trendline.is_empty() {
                None
            } else {
                Some(
                    s.trendline
                        .iter()
                        .map(|t| domain_types::chart::TrendlineData {
                            show: None,
                            r#type: Some(t.trendline_type.to_ooxml().to_string()),
                            color: None,
                            line_width: None,
                            order: t.order,
                            period: t.period,
                            forward: t.forward,
                            backward: t.backward,
                            intercept: None,
                            display_equation: t.disp_eq,
                            display_r_squared: t.disp_r_sqr,
                            name: t.name.clone(),
                            line_format: None,
                            label: None,
                        })
                        .collect(),
                )
            };

            // Error bars
            let (error_bars, x_error_bars, y_error_bars) = extract_error_bars_typed(&s.err_bars);

            // Series-level data labels
            let data_labels = s.d_lbls.as_ref().map(|dl| extract_data_label_data(dl));

            domain_types::chart::ChartSeriesData {
                name,
                r#type: None, // follow-up: derive per-series type for combo charts
                color,
                values,
                categories,
                bubble_size,
                smooth: s.smooth,
                explosion: s.explosion,
                invert_if_negative: s.invert_if_negative,
                y_axis_index: None, // follow-up: derive from c:axId cross-reference
                show_markers,
                marker_size,
                marker_style,
                line_width: None,
                points,
                data_labels,
                trendlines,
                error_bars,
                x_error_bars,
                y_error_bars,
                idx: Some(s.idx),
                order: Some(s.order),
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
        })
        .collect()
}

pub(super) fn chart_import_status_for_renderability(
    series: &[domain_types::chart::ChartSeriesData],
    data_range: Option<&str>,
    part_path: Option<&str>,
    object_name: Option<&str>,
) -> Option<domain_types::ImportObjectStatus> {
    if !series.is_empty() || data_range.is_some() {
        return None;
    }

    let diagnostic_id = domain_types::deterministic_diagnostic_id(
        &domain_types::ImportDiagnosticCode::ChartPartEmptySeries,
        part_path,
        None,
        None,
        None,
        object_name,
    );
    let reference = domain_types::ImportDiagnosticRef {
        id: Some(diagnostic_id),
        part: part_path.map(str::to_string),
        object_name: object_name.map(str::to_string),
        feature_kind: Some(domain_types::ImportFeatureKind::Chart),
        ..domain_types::ImportDiagnosticRef::default()
    };

    Some(domain_types::ImportObjectStatus {
        source: domain_types::ImportSource::Xlsx,
        feature_kind: domain_types::ImportFeatureKind::Chart,
        recoverability: domain_types::ImportRecoverability::PreservedNotRenderable,
        renderability: domain_types::ImportRenderability::Placeholder,
        editability: domain_types::ImportEditability::PartiallyEditable,
        diagnostics: vec![reference.clone()],
        reference: Some(reference),
    })
}

fn extract_num_ref_formula(src: &Option<ooxml_types::charts::NumDataSource>) -> Option<String> {
    match src.as_ref()? {
        ooxml_types::charts::NumDataSource::Ref(nr) => Some(nr.f.clone()),
        ooxml_types::charts::NumDataSource::Lit(_) => None,
    }
}

fn extract_cat_ref_formula(src: &Option<ooxml_types::charts::CatDataSource>) -> Option<String> {
    match src.as_ref()? {
        ooxml_types::charts::CatDataSource::StrRef(sr) => Some(sr.f.clone()),
        ooxml_types::charts::CatDataSource::NumRef(nr) => Some(nr.f.clone()),
        ooxml_types::charts::CatDataSource::MultiLvlStrRef(mr) => Some(mr.f.clone()),
        ooxml_types::charts::CatDataSource::NumLit(_)
        | ooxml_types::charts::CatDataSource::StrLit(_) => None,
    }
}

fn extract_marker_config(
    marker: &Option<ooxml_types::charts::Marker>,
) -> (Option<bool>, Option<u32>, Option<String>) {
    let m = match marker {
        Some(m) => m,
        None => return (None, None, None),
    };
    let show = m
        .symbol
        .as_ref()
        .map(|s| *s != ooxml_types::charts::MarkerStyle::None);
    let size = m.size;
    let style = m.symbol.as_ref().map(|s| s.to_ooxml().to_string());
    (show, size, style)
}

fn extract_error_bars_typed(
    err_bars: &[ooxml_types::charts::ErrorBars],
) -> (
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
) {
    let mut general = None;
    let mut x_bars = None;
    let mut y_bars = None;

    for eb in err_bars {
        let data = domain_types::chart::ErrorBarData {
            visible: None,
            direction: eb.err_dir.as_ref().map(|d| d.to_ooxml().to_string()),
            bar_type: Some(eb.err_bar_type.to_ooxml().to_string()),
            value_type: Some(eb.err_val_type.to_ooxml().to_string()),
            value: eb.val,
            no_end_cap: None,
            line_format: None,
        };
        match eb.err_dir {
            Some(ooxml_types::charts::ErrorBarDirection::X) => x_bars = Some(data),
            Some(ooxml_types::charts::ErrorBarDirection::Y) => y_bars = Some(data),
            None => general = Some(data),
        }
    }

    (general, x_bars, y_bars)
}

pub(super) fn extract_data_label_data(
    dl: &ooxml_types::charts::DataLabelOptions,
) -> domain_types::chart::DataLabelData {
    use ooxml_types::charts::DataLabelPosition;

    let show = dl.show_value || dl.show_category || dl.show_series_name || dl.show_percent;
    let position = match dl.position {
        DataLabelPosition::OutsideEnd => Some("outside".to_string()),
        DataLabelPosition::InsideEnd | DataLabelPosition::InsideBase => Some("inside".to_string()),
        DataLabelPosition::Top => Some("top".to_string()),
        DataLabelPosition::Bottom => Some("bottom".to_string()),
        DataLabelPosition::Left => Some("left".to_string()),
        DataLabelPosition::Right => Some("right".to_string()),
        DataLabelPosition::Center => Some("inside".to_string()),
        DataLabelPosition::BestFit => None,
    };

    domain_types::chart::DataLabelData {
        show,
        position,
        format: None,
        show_value: if dl.show_value { Some(true) } else { None },
        show_category_name: if dl.show_category { Some(true) } else { None },
        show_series_name: if dl.show_series_name {
            Some(true)
        } else {
            None
        },
        show_percentage: if dl.show_percent { Some(true) } else { None },
        show_bubble_size: None,
        show_legend_key: None,
        separator: None,
        show_leader_lines: None,
        text: None,
        visual_format: None,
        number_format: None,
        text_orientation: None,
        rich_text: None,
        auto_text: None,
        horizontal_alignment: None,
        vertical_alignment: None,
        link_number_format: None,
        geometric_shape_type: None,
        formula: None,
        leader_lines_format: None,
    }
}

/// Extract legend as typed LegendData.
pub(super) fn extract_legend(
    chart: &crate::domain::charts::Chart,
) -> Option<domain_types::chart::LegendData> {
    use ooxml_types::charts::LegendPosition;

    chart.legend.as_ref().map(|l| {
        let position = match l.legend_pos.unwrap_or(LegendPosition::Right) {
            LegendPosition::Bottom => "bottom",
            LegendPosition::Top => "top",
            LegendPosition::Left => "left",
            LegendPosition::Right => "right",
            LegendPosition::TopRight => "right",
        };
        domain_types::chart::LegendData {
            show: false,
            position: position.to_string(),
            visible: true,
            overlay: None,
            format: None,
            entries: None,
            custom_x: None,
            custom_y: None,
            shadow: None,
            show_shadow: None,
        }
    })
}

/// Extract axes as typed AxisData.
pub(super) fn extract_axes(
    chart: &crate::domain::charts::Chart,
) -> Option<domain_types::chart::AxisData> {
    let cat_ax = chart
        .plot_area
        .cat_ax
        .as_ref()
        .or(chart.plot_area.date_ax.as_ref());
    let val_ax = chart.plot_area.val_ax.as_ref();

    if cat_ax.is_none() && val_ax.is_none() {
        return None;
    }

    let category_axis = cat_ax.map(|ax| domain_types::chart::SingleAxisData {
        title: ax
            .title
            .as_ref()
            .and_then(crate::domain::charts::axes::extract_title_text),
        visible: !ax.delete,
        ..Default::default()
    });

    let value_axis = val_ax.map(|ax| domain_types::chart::SingleAxisData {
        title: ax
            .title
            .as_ref()
            .and_then(crate::domain::charts::axes::extract_title_text),
        visible: !ax.delete,
        min: ax.scaling.min,
        max: ax.scaling.max,
        ..Default::default()
    });

    Some(domain_types::chart::AxisData {
        category_axis,
        value_axis,
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    })
}

/// Extract chart-level data labels as typed DataLabelData.
pub(super) fn extract_chart_data_labels(
    chart: &crate::domain::charts::Chart,
) -> Option<domain_types::chart::DataLabelData> {
    chart
        .data_labels
        .as_ref()
        .map(|dl| extract_data_label_data(dl))
}

/// Extract a reconstructed data range from all series references.
pub(super) fn extract_data_range(chart: &crate::domain::charts::Chart) -> Option<String> {
    reconstruct_data_range(&chart.series)
}

/// Map Rust ChartType + config to the TS ChartType string.
pub(super) fn map_chart_type_to_ts(chart: &crate::domain::charts::Chart) -> String {
    use ooxml_types::charts::{BarDirection, ChartType, ChartTypeConfig};

    match chart.chart_type {
        ChartType::Bar => {
            // Check bar direction from config
            match &chart.chart_type_config {
                Some(ChartTypeConfig::Bar(bc)) => match bc.bar_dir {
                    BarDirection::Bar => "bar".to_string(),
                    BarDirection::Column => "column".to_string(),
                },
                _ => "column".to_string(),
            }
        }
        ChartType::Bar3D => match &chart.chart_type_config {
            Some(ChartTypeConfig::Bar3D(bc)) => match bc.bar_dir {
                BarDirection::Bar => "bar3d".to_string(),
                BarDirection::Column => "column3d".to_string(),
            },
            _ => "column3d".to_string(),
        },
        ChartType::Line => "line".to_string(),
        ChartType::Line3D => "line3d".to_string(),
        ChartType::Pie => "pie".to_string(),
        ChartType::Pie3D => "pie3d".to_string(),
        ChartType::Doughnut => "doughnut".to_string(),
        ChartType::Area => "area".to_string(),
        ChartType::Area3D => "area3d".to_string(),
        ChartType::Scatter => "scatter".to_string(),
        ChartType::Bubble => "bubble".to_string(),
        ChartType::Radar => "radar".to_string(),
        ChartType::Stock => "stock".to_string(),
        ChartType::Surface => "surface".to_string(),
        ChartType::Surface3D => "surface3d".to_string(),
        ChartType::OfPie => "ofPie".to_string(),
        _ => "column".to_string(), // Default fallback
    }
}

/// Extract sub-type string from chart type config (grouping).
pub(super) fn extract_sub_type(chart: &crate::domain::charts::Chart) -> Option<String> {
    use ooxml_types::charts::ChartTypeConfig;

    match &chart.chart_type_config {
        Some(ChartTypeConfig::Bar(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        Some(ChartTypeConfig::Bar3D(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        Some(ChartTypeConfig::Line(c)) => grouping_to_sub_type(&c.grouping),
        Some(ChartTypeConfig::Line3D(c)) => grouping_to_sub_type(&c.grouping),
        Some(ChartTypeConfig::Area(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        Some(ChartTypeConfig::Area3D(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        _ => None,
    }
}

/// Convert Grouping enum to sub-type string.
fn grouping_to_sub_type(g: &ooxml_types::charts::Grouping) -> Option<String> {
    match g {
        ooxml_types::charts::Grouping::Clustered => Some("clustered".to_string()),
        ooxml_types::charts::Grouping::Stacked => Some("stacked".to_string()),
        ooxml_types::charts::Grouping::PercentStacked => Some("percentStacked".to_string()),
        ooxml_types::charts::Grouping::Standard => None, // Default, don't emit
    }
}

/// Reconstruct an A1-style data range from chart series references.
///
/// Finds the overall bounding range from all series value/category references.
fn reconstruct_data_range(series: &[crate::domain::charts::ChartSeries]) -> Option<String> {
    use crate::domain::charts::series::{CatDataSource, NumDataSource};

    if series.is_empty() {
        return None;
    }

    // Collect all formula references from series
    let mut formulas = Vec::new();
    for s in series {
        if let Some(ref val) = s.val {
            match val {
                NumDataSource::Ref(nr) => formulas.push(nr.f.as_str()),
                NumDataSource::Lit(_) => {}
            }
        }
        if let Some(ref cat) = s.cat {
            match cat {
                CatDataSource::StrRef(sr) => formulas.push(sr.f.as_str()),
                CatDataSource::NumRef(nr) => formulas.push(nr.f.as_str()),
                _ => {}
            }
        }
        if let Some(CatDataSource::NumRef(nr)) = &s.x_val {
            formulas.push(nr.f.as_str())
        }
        if let Some(ref yv) = s.y_val {
            match yv {
                NumDataSource::Ref(nr) => formulas.push(nr.f.as_str()),
                NumDataSource::Lit(_) => {}
            }
        }
    }

    if formulas.is_empty() {
        return None;
    }

    // Use the first formula as the data range (common case: "Sheet1!$A$1:$D$10")
    // A more sophisticated approach would compute the bounding box of all refs,
    // but for import this simple approach works well.
    Some(formulas[0].to_string())
}

/// Extract hex RGB color from chart ShapeProperties fill.
pub(super) fn extract_fill_color(sp_pr: &ooxml_types::charts::ShapeProperties) -> Option<String> {
    use ooxml_types::drawings::DrawingFill;

    match &sp_pr.fill {
        Some(DrawingFill::Solid(sf)) => match &sf.color {
            ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } if !val.is_empty() => {
                Some(val.clone())
            }
            _ => None,
        },
        _ => None,
    }
}

// =============================================================================
// ChartSpace -> ChartSpec pipeline
// =============================================================================

/// Extract a complete ChartSpec from a parsed ChartSpace + drawing anchor metadata.
///
/// This is the NEW extraction pipeline that reads directly from ooxml_types::ChartSpace,
/// populating all enriched ChartSpec fields including formatting and round-trip data.
/// The legacy extraction functions above are preserved until the new pipeline fully replaces them.
pub fn extract_chart_spec_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
    anchor: &super::xml_parsing::ChartRefInfo,
) -> domain_types::ChartSpec {
    use domain_types::chart::{AnchorPosition, ObjectSize};

    let chart = &cs.chart;
    let plot_area = &chart.plot_area;

    // -------------------------------------------------------------------------
    // (a) chart_type — from first chart group
    // -------------------------------------------------------------------------
    let first_group = plot_area.chart_groups.first();
    let chart_type = first_group
        .map(|g| map_ooxml_chart_type_to_domain(g.chart_type, &g.config))
        .unwrap_or(domain_types::ChartType::Column);

    // -------------------------------------------------------------------------
    // (b) sub_type — from first chart group's config grouping
    // -------------------------------------------------------------------------
    let sub_type = first_group.and_then(|g| extract_sub_type_from_config(&g.config));

    // -------------------------------------------------------------------------
    // (c) title — from cs.chart.title
    // -------------------------------------------------------------------------
    let title = chart
        .title
        .as_ref()
        .and_then(|t| extract_title_text_from_title(t));

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
    let title_format = chart
        .title
        .as_ref()
        .and_then(|t| extract_chart_format(t.sp_pr.as_ref(), t.tx_pr.as_ref()));

    // -------------------------------------------------------------------------
    // (i) scalar fields from first chart group's config
    // -------------------------------------------------------------------------
    let (
        gap_width,
        overlap,
        doughnut_hole_size,
        first_slice_angle,
        bubble_scale,
        split_type,
        split_value,
    ) = first_group
        .map(|g| extract_scalar_fields_from_config(&g.config))
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
    // (k) ChartRoundTripData
    // -------------------------------------------------------------------------
    let rt = build_round_trip_data(cs);

    // -------------------------------------------------------------------------
    // display_blanks_as, plot_visible_only
    // -------------------------------------------------------------------------
    let display_blanks_as = chart.disp_blanks_as.map(|d| d.to_ooxml().to_string());
    let plot_visible_only = chart.plot_vis_only;
    let import_status = chart_import_status_for_renderability(
        &series,
        data_range.as_deref(),
        None,
        anchor.cnv_pr_name.as_deref(),
    );

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
        preserved_chart_xml: None,
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
        title_rich_text: None,
        title_formula: None,
        data_table,
        display_blanks_as,
        plot_visible_only,
        gap_width,
        overlap,
        doughnut_hole_size,
        first_slice_angle,
        bubble_scale,
        split_type,
        split_value,
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: None,
        second_plot_size: None,
        vary_by_categories: None,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        view_3d,
        floor_format,
        side_wall_format,
        back_wall_format,
        rt: Some(rt),
        chart_frame: None,
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

// =============================================================================
// Helpers for the new ChartSpace -> ChartSpec pipeline
// =============================================================================

/// Map ooxml ChartType + config to domain ChartType.
fn map_ooxml_chart_type_to_domain(
    ct: ooxml_types::charts::ChartType,
    config: &ooxml_types::charts::ChartTypeConfig,
) -> domain_types::ChartType {
    use ooxml_types::charts::{BarDirection, ChartType as OT, ChartTypeConfig as CTC};

    match ct {
        OT::Bar => match config {
            CTC::Bar(c) => match c.bar_dir {
                BarDirection::Bar => domain_types::ChartType::Bar,
                BarDirection::Column => domain_types::ChartType::Column,
            },
            _ => domain_types::ChartType::Column,
        },
        OT::Bar3D => domain_types::ChartType::Bar3D,
        OT::Line => domain_types::ChartType::Line,
        OT::Line3D => domain_types::ChartType::Line3D,
        OT::Pie => domain_types::ChartType::Pie,
        OT::Pie3D => domain_types::ChartType::Pie3D,
        OT::Doughnut => domain_types::ChartType::Doughnut,
        OT::Area => domain_types::ChartType::Area,
        OT::Area3D => domain_types::ChartType::Area3D,
        OT::Scatter => domain_types::ChartType::Scatter,
        OT::Bubble => domain_types::ChartType::Bubble,
        OT::Radar => domain_types::ChartType::Radar,
        OT::Stock => domain_types::ChartType::Stock,
        OT::Surface => domain_types::ChartType::Surface,
        OT::Surface3D => domain_types::ChartType::Surface3D,
        OT::OfPie => domain_types::ChartType::OfPie,
        OT::Combo => domain_types::ChartType::Combo,
        OT::Unknown => domain_types::ChartType::Column,
    }
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

/// Extract title text from a Title element.
fn extract_title_text_from_title(title: &ooxml_types::charts::Title) -> Option<String> {
    use ooxml_types::charts::ChartText;
    use ooxml_types::drawings::TextRunContent;

    match &title.tx {
        Some(ChartText::Rich(body)) => {
            let mut parts = Vec::new();
            for para in &body.paragraphs {
                for run_content in &para.runs {
                    if let TextRunContent::Run(run) = run_content {
                        if !run.text.is_empty() {
                            parts.push(run.text.clone());
                        }
                    }
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(""))
            }
        }
        Some(ChartText::StrRef(str_ref)) => str_ref
            .str_cache
            .as_ref()
            .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
        None => None,
    }
}

/// Extract all series from all chart groups in the ChartSpace.
fn extract_series_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Vec<domain_types::chart::ChartSeriesData> {
    cs.chart
        .plot_area
        .chart_groups
        .iter()
        .flat_map(|g| g.series.iter().map(|s| extract_single_series(s)))
        .collect()
}

/// Extract a single series from an ooxml ChartSeries.
fn extract_single_series(
    s: &ooxml_types::charts::ChartSeries,
) -> domain_types::chart::ChartSeriesData {
    use ooxml_types::charts::SeriesTextSource;

    // Name
    let name = s.tx.as_ref().and_then(|tx| match tx {
        SeriesTextSource::Value(v) => Some(v.clone()),
        SeriesTextSource::StrRef(sr) => sr
            .str_cache
            .as_ref()
            .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
    });

    // Legacy fill color
    let color = s.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));

    // Values range: val (standard) or y_val (scatter/bubble)
    let values = extract_num_ref_formula(&s.val).or_else(|| extract_num_ref_formula(&s.y_val));

    // Categories range: cat (standard) or x_val (scatter/bubble)
    let categories = extract_cat_ref_formula(&s.cat).or_else(|| extract_cat_ref_formula(&s.x_val));

    let bubble_size = extract_num_ref_formula(&s.bubble_size);

    // Markers
    let (show_markers, marker_size, marker_style) = extract_marker_config(&s.marker);

    // Per-point formatting
    let points = if s.d_pt.is_empty() {
        None
    } else {
        Some(
            s.d_pt
                .iter()
                .map(|pt| {
                    let fill = pt.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));
                    let visual_format = extract_chart_format(pt.sp_pr.as_ref(), None);
                    domain_types::chart::PointFormatData {
                        idx: pt.idx,
                        fill,
                        border: None,
                        data_label: None,
                        visual_format,
                        marker_background_color: None,
                        marker_foreground_color: None,
                        marker_size: None,
                        marker_style: None,
                    }
                })
                .collect(),
        )
    };

    // Trendlines
    let trendlines = if s.trendline.is_empty() {
        None
    } else {
        Some(
            s.trendline
                .iter()
                .map(|t| {
                    let line_format = t
                        .sp_pr
                        .as_ref()
                        .and_then(|sp| sp.ln.as_ref())
                        .map(|ln| extract_chart_line(ln));
                    let label = t.trendline_lbl.as_ref().map(|lbl| {
                        let text = lbl.tx.as_ref().and_then(|tx| extract_chart_text_string(tx));
                        let format = extract_chart_format(lbl.sp_pr.as_ref(), lbl.tx_pr.as_ref());
                        let number_format = lbl.num_fmt.as_ref().map(|nf| nf.format_code.clone());
                        let layout = lbl.layout.as_ref().map(Into::into);
                        domain_types::chart::TrendlineLabelData {
                            text,
                            format,
                            number_format,
                            layout,
                        }
                    });
                    domain_types::chart::TrendlineData {
                        show: None,
                        r#type: Some(t.trendline_type.to_ooxml().to_string()),
                        color: None,
                        line_width: None,
                        order: t.order,
                        period: t.period,
                        forward: t.forward,
                        backward: t.backward,
                        intercept: t.intercept,
                        display_equation: t.disp_eq,
                        display_r_squared: t.disp_r_sqr,
                        name: t.name.clone(),
                        line_format,
                        label,
                    }
                })
                .collect(),
        )
    };

    // Error bars
    let (error_bars, x_error_bars, y_error_bars) = extract_error_bars_new(&s.err_bars);

    // Series-level data labels
    let data_labels = s.d_lbls.as_ref().map(|dl| extract_data_label_data(dl));

    // Rich format from sp_pr + tx_pr
    let format = extract_chart_format(s.sp_pr.as_ref(), None);

    // Bar shape
    let bar_shape = s.shape.map(|bs| bs.to_ooxml().to_string());

    domain_types::chart::ChartSeriesData {
        name,
        r#type: None,
        color,
        values,
        categories,
        bubble_size,
        smooth: s.smooth,
        explosion: s.explosion,
        invert_if_negative: s.invert_if_negative,
        y_axis_index: None,
        show_markers,
        marker_size,
        marker_style,
        line_width: None,
        points,
        data_labels,
        trendlines,
        error_bars,
        x_error_bars,
        y_error_bars,
        idx: Some(s.idx),
        order: Some(s.order),
        format,
        bar_shape,
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

/// Extract error bars with line_format support.
fn extract_error_bars_new(
    err_bars: &[ooxml_types::charts::ErrorBars],
) -> (
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
) {
    let mut general = None;
    let mut x_bars = None;
    let mut y_bars = None;

    for eb in err_bars {
        let line_format = eb
            .sp_pr
            .as_ref()
            .and_then(|sp| sp.ln.as_ref())
            .map(|ln| extract_chart_line(ln));
        let data = domain_types::chart::ErrorBarData {
            visible: None,
            direction: eb.err_dir.as_ref().map(|d| d.to_ooxml().to_string()),
            bar_type: Some(eb.err_bar_type.to_ooxml().to_string()),
            value_type: Some(eb.err_val_type.to_ooxml().to_string()),
            value: eb.val,
            no_end_cap: eb.no_end_cap,
            line_format,
        };
        match eb.err_dir {
            Some(ooxml_types::charts::ErrorBarDirection::X) => x_bars = Some(data),
            Some(ooxml_types::charts::ErrorBarDirection::Y) => y_bars = Some(data),
            None => general = Some(data),
        }
    }

    (general, x_bars, y_bars)
}

/// Extract legend from ChartSpace.
fn extract_legend_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Option<domain_types::chart::LegendData> {
    use ooxml_types::charts::LegendPosition;

    cs.chart.legend.as_ref().map(|l| {
        let position = match l.legend_pos.unwrap_or(LegendPosition::Right) {
            LegendPosition::Bottom => "bottom",
            LegendPosition::Top => "top",
            LegendPosition::Left => "left",
            LegendPosition::Right => "right",
            LegendPosition::TopRight => "right",
        };

        let format = extract_chart_format(l.sp_pr.as_ref(), l.tx_pr.as_ref());

        let entries = if l.legend_entry.is_empty() {
            None
        } else {
            Some(
                l.legend_entry
                    .iter()
                    .map(|le| {
                        let entry_format = le
                            .tx_pr
                            .as_ref()
                            .and_then(|tp| extract_chart_format(None, Some(tp)));
                        domain_types::chart::LegendEntryData {
                            idx: le.idx,
                            delete: le.delete,
                            format: entry_format,
                            visible: None,
                        }
                    })
                    .collect(),
            )
        };

        domain_types::chart::LegendData {
            show: false,
            position: position.to_string(),
            visible: true,
            overlay: l.overlay,
            format,
            entries,
            custom_x: None,
            custom_y: None,
            shadow: None,
            show_shadow: None,
        }
    })
}

/// Extract axes from ChartSpace.
fn extract_axes_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Option<domain_types::chart::AxisData> {
    use ooxml_types::charts::AxisType;

    let axes = &cs.chart.plot_area.axes;
    if axes.is_empty() {
        return None;
    }

    // Collect axes by type. For multi-axis charts, we pick the first of each type
    // as primary and subsequent as secondary.
    let mut cat_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();
    let mut val_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();
    let mut date_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();
    let mut ser_axes: Vec<&ooxml_types::charts::ChartAxis> = Vec::new();

    for ax in axes {
        match ax.axis_type {
            AxisType::Category => cat_axes.push(ax),
            AxisType::Value => val_axes.push(ax),
            AxisType::Date => date_axes.push(ax),
            AxisType::Series => ser_axes.push(ax),
        }
    }

    // Category axis: first catAx or first dateAx as fallback
    let primary_cat = cat_axes
        .first()
        .copied()
        .or_else(|| date_axes.first().copied());
    let secondary_cat = cat_axes.get(1).copied().or_else(|| {
        if cat_axes.is_empty() {
            date_axes.get(1).copied()
        } else {
            date_axes.first().copied()
        }
    });

    let primary_val = val_axes.first().copied();
    let secondary_val = val_axes.get(1).copied();
    let series_axis = ser_axes.first().copied();

    let category_axis = primary_cat.map(|ax| extract_single_axis(ax));
    let value_axis = primary_val.map(|ax| extract_single_axis(ax));
    let secondary_category_axis = secondary_cat.map(|ax| extract_single_axis(ax));
    let secondary_value_axis = secondary_val.map(|ax| extract_single_axis(ax));
    let series_axis = series_axis.map(|ax| extract_single_axis(ax));

    Some(domain_types::chart::AxisData {
        category_axis,
        value_axis,
        secondary_category_axis,
        secondary_value_axis,
        series_axis,
    })
}

/// Extract a single axis to SingleAxisData.
fn extract_single_axis(ax: &ooxml_types::charts::ChartAxis) -> domain_types::chart::SingleAxisData {
    use ooxml_types::charts::{DisplayUnitKind, Orientation, TickMark};

    let title = ax
        .title
        .as_ref()
        .and_then(|t| extract_title_text_from_title(t));

    let visible = !ax.delete;

    let min = ax.scaling.min;
    let max = ax.scaling.max;
    let major_unit = ax.major_unit;
    let minor_unit = ax.minor_unit;
    let log_base = ax.scaling.log_base;

    let reverse = if ax.scaling.orientation == Orientation::MaxMin {
        Some(true)
    } else {
        None
    };

    let position = Some(ax.ax_pos.to_ooxml().to_string());

    let tick_marks = match ax.major_tick_mark {
        TickMark::Cross => None, // default
        other => Some(other.to_ooxml().to_string()),
    };
    let minor_tick_marks = match ax.minor_tick_mark {
        TickMark::Cross => None,
        other => Some(other.to_ooxml().to_string()),
    };

    let number_format = ax.num_fmt.as_ref().map(|nf| nf.format_code.clone());

    let axis_type = Some(ax.axis_type.to_ooxml().to_string());

    let grid_lines = if ax.major_gridlines.is_some() {
        Some(true)
    } else {
        None
    };
    let minor_grid_lines = if ax.minor_gridlines.is_some() {
        Some(true)
    } else {
        None
    };

    // Display units
    let (display_unit, custom_display_unit, display_unit_label) = ax
        .disp_units
        .as_ref()
        .map(|du| {
            let (bu, cu) = match &du.kind {
                Some(DisplayUnitKind::BuiltIn(b)) => (Some(b.to_ooxml().to_string()), None),
                Some(DisplayUnitKind::Custom(v)) => (None, Some(*v)),
                None => (None, None),
            };
            let label = du
                .disp_units_lbl
                .as_ref()
                .and_then(|lbl| lbl.tx.as_ref().and_then(|tx| extract_chart_text_string(tx)));
            (bu, cu, label)
        })
        .unwrap_or((None, None, None));

    // Formatting
    let format = extract_chart_format(ax.sp_pr.as_ref(), ax.tx_pr.as_ref());
    let title_format = ax
        .title
        .as_ref()
        .and_then(|t| extract_chart_format(t.sp_pr.as_ref(), t.tx_pr.as_ref()));
    let gridline_format = ax
        .major_gridlines
        .as_ref()
        .and_then(|gl| gl.sp_pr.as_ref())
        .and_then(|sp| sp.ln.as_ref())
        .map(|ln| extract_chart_line(ln));
    let minor_gridline_format = ax
        .minor_gridlines
        .as_ref()
        .and_then(|gl| gl.sp_pr.as_ref())
        .and_then(|sp| sp.ln.as_ref())
        .map(|ln| extract_chart_line(ln));

    // Cross between
    let cross_between = ax.cross_between.map(|cb| cb.to_ooxml().to_string());

    // Tick label position
    let tick_label_position = {
        let tlp = ax.tick_lbl_pos;
        match tlp {
            ooxml_types::charts::TickLabelPosition::NextTo => None, // default
            other => Some(other.to_ooxml().to_string()),
        }
    };

    // Time units (dateAx)
    let base_time_unit = ax.base_time_unit.map(|tu| tu.to_ooxml().to_string());
    let major_time_unit = ax.major_time_unit.map(|tu| tu.to_ooxml().to_string());
    let minor_time_unit = ax.minor_time_unit.map(|tu| tu.to_ooxml().to_string());

    // Label alignment (catAx)
    let label_alignment = ax.lbl_algn.map(|la| la.to_ooxml().to_string());
    let label_offset = ax.lbl_offset;
    let no_multi_level_labels = ax.no_multi_lvl_lbl;

    domain_types::chart::SingleAxisData {
        title,
        visible,
        min,
        max,
        axis_type,
        grid_lines,
        minor_grid_lines,
        major_unit,
        minor_unit,
        tick_marks,
        minor_tick_marks,
        number_format,
        reverse,
        position,
        log_base,
        display_unit,
        format,
        title_format,
        gridline_format,
        minor_gridline_format,
        cross_between,
        tick_label_position,
        base_time_unit,
        major_time_unit,
        minor_time_unit,
        custom_display_unit,
        display_unit_label,
        label_alignment,
        label_offset,
        no_multi_level_labels,
        ..Default::default()
    }
}

/// Extract scalar chart-level fields from the first chart group's config.
/// Returns (gap_width, overlap, doughnut_hole_size, first_slice_angle, bubble_scale, split_type, split_value).
type ScalarChartFields = (
    Option<u32>,
    Option<i32>,
    Option<u32>,
    Option<u32>,
    Option<u32>,
    Option<String>,
    Option<f64>,
);

fn extract_scalar_fields_from_config(
    config: &ooxml_types::charts::ChartTypeConfig,
) -> ScalarChartFields {
    use ooxml_types::charts::ChartTypeConfig as CTC;

    match config {
        CTC::Bar(c) => (c.gap_width, c.overlap, None, None, None, None, None),
        CTC::Bar3D(c) => (c.gap_width, None, None, None, None, None, None),
        CTC::Pie(c) => (None, None, None, c.first_slice_ang, None, None, None),
        CTC::Pie3D(_) => (None, None, None, None, None, None, None),
        CTC::Doughnut(c) => (None, None, c.hole_size, c.first_slice_ang, None, None, None),
        CTC::Bubble(c) => (None, None, None, None, c.bubble_scale, None, None),
        CTC::OfPie(c) => {
            let split_type = c.split_type.map(|st| st.to_ooxml().to_string());
            let split_value = c.split_pos;
            (c.gap_width, None, None, None, None, split_type, split_value)
        }
        _ => (None, None, None, None, None, None, None),
    }
}

/// Reconstruct a data range from all series in the ChartSpace.
fn reconstruct_data_range_from_chart_space(cs: &ooxml_types::charts::ChartSpace) -> Option<String> {
    let mut formulas: Vec<&str> = Vec::new();

    for g in &cs.chart.plot_area.chart_groups {
        for s in &g.series {
            if let Some(ref val) = s.val {
                if let Some(f) = extract_num_ref_formula_str(val) {
                    formulas.push(f);
                }
            }
            if let Some(ref cat) = s.cat {
                if let Some(f) = extract_cat_ref_formula_str(cat) {
                    formulas.push(f);
                }
            }
            if let Some(ref xv) = s.x_val {
                if let Some(f) = extract_cat_ref_formula_str(xv) {
                    formulas.push(f);
                }
            }
            if let Some(ref yv) = s.y_val {
                if let Some(f) = extract_num_ref_formula_str(yv) {
                    formulas.push(f);
                }
            }
        }
    }

    formulas.first().map(|f| f.to_string())
}

fn extract_num_ref_formula_str(src: &ooxml_types::charts::NumDataSource) -> Option<&str> {
    match src {
        ooxml_types::charts::NumDataSource::Ref(nr) => Some(&nr.f),
        ooxml_types::charts::NumDataSource::Lit(_) => None,
    }
}

fn extract_cat_ref_formula_str(src: &ooxml_types::charts::CatDataSource) -> Option<&str> {
    match src {
        ooxml_types::charts::CatDataSource::StrRef(sr) => Some(&sr.f),
        ooxml_types::charts::CatDataSource::NumRef(nr) => Some(&nr.f),
        ooxml_types::charts::CatDataSource::MultiLvlStrRef(mr) => Some(&mr.f),
        ooxml_types::charts::CatDataSource::NumLit(_)
        | ooxml_types::charts::CatDataSource::StrLit(_) => None,
    }
}

/// Build ChartRoundTripData from ChartSpace.
fn build_round_trip_data(
    cs: &ooxml_types::charts::ChartSpace,
) -> domain_types::chart::ChartRoundTripData {
    let chart = &cs.chart;
    let plot_area = &chart.plot_area;

    // Chart groups meta
    let chart_groups_meta: Vec<domain_types::chart::ChartGroupMeta> = plot_area
        .chart_groups
        .iter()
        .map(|g| {
            let series_indices: Vec<u32> = g.series.iter().map(|s| s.idx).collect();
            // Chart-type discriminant: prefer non-standard @chartType
            // attribute verbatim (Google Sheets exports) via
            // `ChartType::Unknown(s)`, else map the OOXML enum to the
            // domain superset. This folds the prior `raw_chart_type_attr`
            // sidecar into a single typed field (inventory row 2.21).
            let chart_type = if let Some(ref raw) = g.raw_chart_type_attr {
                domain_types::chart::ChartType::Unknown(raw.clone())
            } else {
                domain_types::chart::ChartType::from_ooxml(g.chart_type)
            };
            domain_types::chart::ChartGroupMeta {
                chart_type,
                config_template: (&g.config).into(),
                ax_ids: g.ax_id.clone(),
                series_indices,
            }
        })
        .collect();

    // Axes ordered (ax_ids in original order)
    let axes_ordered: Vec<u32> = plot_area.axes.iter().map(|ax| ax.ax_id).collect();

    domain_types::chart::ChartRoundTripData {
        chart_groups_meta,
        axes_ordered,
        protection: cs.protection.as_ref().map(Into::into),
        print_settings: cs.print_settings.as_ref().map(Into::into),
        external_data: cs.external_data.as_ref().map(Into::into),
        pivot_source: cs.pivot_source.as_ref().map(Into::into),
        pivot_fmts: chart.pivot_fmts.iter().map(Into::into).collect(),
        clr_map_ovr: cs.clr_map_ovr.as_ref().map(Into::into),
        user_shapes: cs.user_shapes.clone(),
        date1904: cs.date1904,
        lang: cs.lang.clone(),
        chart_space_extensions: cs.extensions.clone(),
        chart_extensions: chart.extensions.clone(),
        plot_area_extensions: plot_area.extensions.clone(),
        has_empty_chart_ext_lst: chart.has_empty_ext_lst,
        plot_area_layout: plot_area.layout.as_ref().map(Into::into),
        style_alternate_content: cs.style_alternate_content.clone(),
        style_after_chart: cs.style_after_chart,
        auxiliary_files: Vec::new(), // populated later when archive bytes are available
        chart_rels_bytes: None,      // populated later when archive bytes are available
    }
}

// =============================================================================
// Formatting extraction helpers
// =============================================================================

/// Extract ChartFormatData from optional ShapeProperties and TextBody.
fn extract_chart_format(
    sp_pr: Option<&ooxml_types::charts::ShapeProperties>,
    tx_pr: Option<&ooxml_types::drawings::TextBody>,
) -> Option<domain_types::chart::ChartFormatData> {
    let fill = sp_pr
        .and_then(|sp| sp.fill.as_ref())
        .map(|f| extract_chart_fill(f));
    let line = sp_pr
        .and_then(|sp| sp.ln.as_ref())
        .map(|ln| extract_chart_line(ln));
    let font = tx_pr.and_then(|tp| extract_chart_font(tp));
    let text_rotation = tx_pr
        .map(|tp| &tp.body_props)
        .and_then(|bp| bp.rot)
        .map(|r| r.value() as f64 / 60000.0);

    if fill.is_none() && line.is_none() && font.is_none() && text_rotation.is_none() {
        return None;
    }

    Some(domain_types::chart::ChartFormatData {
        fill,
        line,
        font,
        text_rotation,
        shadow: None,
    })
}

/// Extract ChartFillData from a DrawingFill.
fn extract_chart_fill(
    fill: &ooxml_types::drawings::DrawingFill,
) -> domain_types::chart::ChartFillData {
    use ooxml_types::drawings::DrawingFill;

    match fill {
        DrawingFill::NoFill => domain_types::chart::ChartFillData::NoFill,
        DrawingFill::Solid(sf) => {
            let color = extract_chart_color(&sf.color);
            let transparency = extract_alpha_transparency(&sf.color);
            match color {
                Some(c) => domain_types::chart::ChartFillData::Solid {
                    color: c,
                    transparency,
                },
                None => domain_types::chart::ChartFillData::NoFill,
            }
        }
        DrawingFill::Gradient(gf) => {
            let gradient_type = if gf.path.is_some() {
                match gf.path {
                    Some(ooxml_types::drawings::GradientPathType::Circle) => {
                        domain_types::chart::ChartGradientType::Radial
                    }
                    Some(ooxml_types::drawings::GradientPathType::Rect)
                    | Some(ooxml_types::drawings::GradientPathType::Shape) => {
                        domain_types::chart::ChartGradientType::Rectangular
                    }
                    None => domain_types::chart::ChartGradientType::Linear,
                }
            } else {
                domain_types::chart::ChartGradientType::Linear
            };

            let angle = gf.lin_ang.map(|a| a.value() as f64 / 60000.0);

            let stops = gf
                .stops
                .iter()
                .filter_map(|gs| {
                    let color = extract_chart_color(&gs.color)?;
                    let transparency = extract_alpha_transparency(&gs.color);
                    Some(domain_types::chart::ChartGradientStop {
                        position: gs.position.value() as f64 / 100000.0,
                        color,
                        transparency,
                    })
                })
                .collect();

            domain_types::chart::ChartFillData::Gradient {
                gradient_type,
                angle,
                stops,
            }
        }
        DrawingFill::Pattern(pf) => {
            let pattern = pf
                .preset
                .as_ref()
                .map(|p| p.to_ooxml().to_string())
                .unwrap_or_default();
            let foreground = pf.fg_color.as_ref().and_then(|c| extract_chart_color(c));
            let background = pf.bg_color.as_ref().and_then(|c| extract_chart_color(c));
            domain_types::chart::ChartFillData::Pattern {
                pattern,
                foreground,
                background,
            }
        }
        // BlipFill and Group — not representable in our domain model, fallback to NoFill
        _ => domain_types::chart::ChartFillData::NoFill,
    }
}

/// Extract ChartLineData from an Outline.
fn extract_chart_line(
    outline: &ooxml_types::drawings::Outline,
) -> domain_types::chart::ChartLineData {
    use ooxml_types::drawings::{LineDash, LineFill};

    let color = outline.fill.as_ref().and_then(|lf| match lf {
        LineFill::Solid(sf) => extract_chart_color(&sf.color),
        _ => None,
    });

    let width = outline.width.map(|w| w as f64 / 12700.0); // EMU to points

    let dash_style = outline.dash.as_ref().and_then(|d| match d {
        LineDash::Preset(ds) => {
            use ooxml_types::drawings::DashStyle;
            match ds {
                DashStyle::Solid => Some(domain_types::chart::ChartDashStyle::Solid),
                DashStyle::Dot | DashStyle::SystemDot => {
                    Some(domain_types::chart::ChartDashStyle::Dot)
                }
                DashStyle::Dash | DashStyle::SystemDash => {
                    Some(domain_types::chart::ChartDashStyle::Dash)
                }
                DashStyle::DashDot | DashStyle::SystemDashDot => {
                    Some(domain_types::chart::ChartDashStyle::DashDot)
                }
                DashStyle::LongDash => Some(domain_types::chart::ChartDashStyle::LongDash),
                DashStyle::LongDashDot => Some(domain_types::chart::ChartDashStyle::LongDashDot),
                DashStyle::LongDashDotDot | DashStyle::SystemDashDotDot => {
                    Some(domain_types::chart::ChartDashStyle::LongDashDotDot)
                }
            }
        }
        LineDash::Custom(_) => None,
    });

    let transparency = outline.fill.as_ref().and_then(|lf| match lf {
        LineFill::Solid(sf) => extract_alpha_transparency(&sf.color),
        _ => None,
    });

    domain_types::chart::ChartLineData {
        color,
        width,
        dash_style,
        transparency,
    }
}

/// Extract ChartFontData from a TextBody (uses defRPr from first paragraph).
fn extract_chart_font(
    tx_pr: &ooxml_types::drawings::TextBody,
) -> Option<domain_types::chart::ChartFontData> {
    // Use defRPr from first paragraph's properties
    let rpr = tx_pr
        .paragraphs
        .first()
        .and_then(|p| p.props.def_run_props.as_ref());

    let rpr = rpr.map(|b| b.as_ref())?;

    let name = rpr.latin.as_ref().map(|f| f.typeface.clone());
    let size = rpr.size.map(|s| s.value() as f64 / 100.0); // hundredths of a point to points
    let bold = rpr.bold;
    let italic = rpr.italic;
    let color = rpr.color.as_ref().and_then(|c| extract_chart_color(c));

    let underline = rpr.underline.and_then(|u| {
        use ooxml_types::drawings::TextUnderlineType;
        match u {
            TextUnderlineType::None => None, // Don't emit for "none"
            TextUnderlineType::Single => Some(domain_types::chart::ChartUnderlineStyle::Single),
            TextUnderlineType::Double => Some(domain_types::chart::ChartUnderlineStyle::Double),
            TextUnderlineType::Dash | TextUnderlineType::DashHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::Dash)
            }
            TextUnderlineType::DashLong | TextUnderlineType::DashLongHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::DashLong)
            }
            TextUnderlineType::DotDash | TextUnderlineType::DotDashHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::DotDash)
            }
            TextUnderlineType::DotDotDash | TextUnderlineType::DotDotDashHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::DotDotDash)
            }
            TextUnderlineType::Dotted | TextUnderlineType::DottedHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::Dotted)
            }
            TextUnderlineType::Heavy => Some(domain_types::chart::ChartUnderlineStyle::Heavy),
            TextUnderlineType::Wavy => Some(domain_types::chart::ChartUnderlineStyle::Wavy),
            TextUnderlineType::WavyDouble => {
                Some(domain_types::chart::ChartUnderlineStyle::WavyDouble)
            }
            TextUnderlineType::WavyHeavy => {
                Some(domain_types::chart::ChartUnderlineStyle::WavyHeavy)
            }
            TextUnderlineType::Words => Some(domain_types::chart::ChartUnderlineStyle::Words),
        }
    });

    let strikethrough = rpr.strike.and_then(|s| {
        use ooxml_types::drawings::TextStrikeType;
        match s {
            TextStrikeType::NoStrike => None,
            TextStrikeType::SingleStrike => Some(domain_types::chart::ChartStrikeStyle::Single),
            TextStrikeType::DoubleStrike => Some(domain_types::chart::ChartStrikeStyle::Double),
        }
    });

    if name.is_none()
        && size.is_none()
        && bold.is_none()
        && italic.is_none()
        && color.is_none()
        && underline.is_none()
        && strikethrough.is_none()
    {
        return None;
    }

    Some(domain_types::chart::ChartFontData {
        name,
        size,
        bold,
        italic,
        color,
        underline,
        strikethrough,
    })
}

/// Extract ChartColorData from a DrawingColor.
fn extract_chart_color(
    color: &ooxml_types::drawings::DrawingColor,
) -> Option<domain_types::chart::ChartColorData> {
    use ooxml_types::drawings::{ColorTransform, DrawingColor};

    match color {
        DrawingColor::SrgbClr { val, .. } if !val.is_empty() => {
            Some(domain_types::chart::ChartColorData::Hex(val.clone()))
        }
        DrawingColor::SchemeClr { val, transforms } => {
            let theme = val.to_ooxml().to_string();
            // Extract tint/shade transform if present
            let tint_shade = transforms.iter().find_map(|t| match t {
                ColorTransform::Tint { val } => Some(*val as f64 / 100000.0),
                ColorTransform::Shade { val } => Some(-(*val as f64 / 100000.0)),
                _ => None,
            });
            Some(domain_types::chart::ChartColorData::Theme { theme, tint_shade })
        }
        DrawingColor::SysClr { last_clr, .. } => {
            // Use last computed color if available
            last_clr
                .as_ref()
                .filter(|c| !c.is_empty())
                .map(|c| domain_types::chart::ChartColorData::Hex(c.clone()))
        }
        DrawingColor::PrstClr { val, .. } => Some(domain_types::chart::ChartColorData::Hex(
            val.to_ooxml().to_string(),
        )),
        // ScrgbClr, HslClr — not directly representable in our domain model
        _ => None,
    }
}

/// Extract alpha transparency from color transforms.
/// Returns Some(fraction) where 0.0 = fully opaque, 1.0 = fully transparent.
fn extract_alpha_transparency(color: &ooxml_types::drawings::DrawingColor) -> Option<f64> {
    use ooxml_types::drawings::ColorTransform;

    let transforms = match color {
        ooxml_types::drawings::DrawingColor::SrgbClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::SchemeClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::HslClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::SysClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::PrstClr { transforms, .. } => transforms,
        ooxml_types::drawings::DrawingColor::ScrgbClr { transforms, .. } => transforms,
    };

    transforms.iter().find_map(|t| match t {
        ColorTransform::Alpha { val } => {
            let opacity = *val as f64 / 100000.0; // 0-1
            let transparency = 1.0 - opacity;
            if transparency > 0.001 {
                Some(transparency)
            } else {
                None
            }
        }
        _ => None,
    })
}

/// Extract plain text from a ChartText (CT_Tx).
fn extract_chart_text_string(ct: &ooxml_types::charts::ChartText) -> Option<String> {
    use ooxml_types::charts::ChartText;
    use ooxml_types::drawings::TextRunContent;

    match ct {
        ChartText::Rich(body) => {
            let mut parts = Vec::new();
            for para in &body.paragraphs {
                for run_content in &para.runs {
                    if let TextRunContent::Run(run) = run_content {
                        if !run.text.is_empty() {
                            parts.push(run.text.clone());
                        }
                    }
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(""))
            }
        }
        ChartText::StrRef(str_ref) => str_ref
            .str_cache
            .as_ref()
            .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
    }
}
