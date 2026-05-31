use super::axes::extract_axes_from_chart_space;
use super::common::{
    chart_import_status_for_renderability, chart_import_status_for_unsupported_chart_type,
    map_ooxml_chart_type_to_domain,
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
    let sub_type = first_group.and_then(|g| extract_sub_type_from_config(&g.config));

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
    let chart_style_context = cs
        .clr_map_ovr
        .as_ref()
        .map(|color_map_override| domain_types::ChartStyleContextData {
            color_map_override: Some(color_map_override.into()),
            ..Default::default()
        });
    let import_status = match &chart_type {
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

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::charts::{
        AreaChartConfig, Chart as OoxmlChart, ChartGroup, ChartSpace, ChartText, ChartType,
        ChartTypeConfig, LineChartConfig, PlotArea, Title,
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
            clr_map_ovr: Some(ooxml_types::themes::ColorMappingOverride::OverrideClrMapping(
                ooxml_types::themes::ColorMapping {
                    bg1: ooxml_types::themes::ColorSchemeIndex::Dk2,
                    tx1: ooxml_types::themes::ColorSchemeIndex::Accent2,
                    ..Default::default()
                },
            )),
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
