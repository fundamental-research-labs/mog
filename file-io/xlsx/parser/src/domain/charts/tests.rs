use super::*;

fn test_chart_ref_info() -> read::ChartRefInfo {
    read::ChartRefInfo {
        target: "xl/charts/chart1.xml".to_string(),
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

fn project_chart_xml(xml: &[u8]) -> domain_types::ChartSpec {
    let chart = Chart::parse(xml);
    let chart_space = chart.chart_space.as_ref().expect("canonical chart space");
    read::extract_chart_spec_from_chart_space(chart_space, &test_chart_ref_info())
}

fn solid_fill_hex(fill: Option<&ooxml_types::drawings::DrawingFill>) -> Option<&str> {
    match fill {
        Some(ooxml_types::drawings::DrawingFill::Solid(solid)) => drawing_color_hex(&solid.color),
        _ => None,
    }
}

fn line_solid_hex(line: Option<&ooxml_types::drawings::Outline>) -> Option<&str> {
    match line.and_then(|line| line.fill.as_ref()) {
        Some(ooxml_types::drawings::LineFill::Solid(solid)) => drawing_color_hex(&solid.color),
        _ => None,
    }
}

fn line_is_no_fill(line: Option<&ooxml_types::drawings::Outline>) -> bool {
    matches!(
        line.and_then(|line| line.fill.as_ref()),
        Some(ooxml_types::drawings::LineFill::NoFill)
    )
}

fn drawing_color_hex(color: &ooxml_types::drawings::DrawingColor) -> Option<&str> {
    match color {
        ooxml_types::drawings::DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
        _ => None,
    }
}

#[test]
fn test_parse_empty_chart() {
    let xml = b"<?xml version=\"1.0\"?><chartSpace></chartSpace>";
    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Unknown);
    assert!(chart.title.is_none());
    assert!(chart.legend.is_none());
}

#[test]
fn test_parse_bar_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Bar);
    assert!(!chart.is_3d);
    assert_eq!(chart.series.len(), 1);
}

#[test]
fn test_parse_chart_color_map_override() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:clrMapOvr>
                <a:overrideClrMapping bg1="dk2" tx1="accent2" bg2="lt2" tx2="accent3"
                    accent1="accent4" accent2="accent5" accent3="accent6" accent4="hlink"
                    accent5="folHlink" accent6="dk1" hlink="lt1" folHlink="accent1"/>
            </c:clrMapOvr>
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    let chart_space = chart.chart_space.expect("expected chart space");
    let override_mapping = chart_space
        .clr_map_ovr
        .expect("expected clrMapOvr override");

    match override_mapping {
        ooxml_types::themes::ColorMappingOverride::OverrideClrMapping(mapping) => {
            assert_eq!(mapping.bg1, ooxml_types::themes::ColorSchemeIndex::Dk2);
            assert_eq!(mapping.tx1, ooxml_types::themes::ColorSchemeIndex::Accent2);
            assert_eq!(
                mapping.fol_hlink,
                ooxml_types::themes::ColorSchemeIndex::Accent1
            );
        }
        other => panic!("expected override color mapping, got {other:?}"),
    }
}

#[test]
fn test_parse_chart_color_map_master_mapping() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:clrMapOvr>
                <a:masterClrMapping/>
            </c:clrMapOvr>
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    let chart_space = chart.chart_space.expect("expected chart space");

    assert!(matches!(
        chart_space.clr_map_ovr,
        Some(ooxml_types::themes::ColorMappingOverride::MasterClrMapping)
    ));
}

#[test]
fn test_parse_pie_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:pieChart>
                        <c:ser>
                            <c:idx val="0"/>
                            <c:order val="0"/>
                        </c:ser>
                    </c:pieChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Pie);
    assert!(!chart.is_3d);
}

#[test]
fn test_parse_3d_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:bar3DChart>
                        <c:barDir val="col"/>
                    </c:bar3DChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Bar3D);
    assert!(chart.is_3d);
}

#[test]
fn test_project_bar3d_gap_depth_and_shape() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:bar3DChart>
                        <c:barDir val="col"/>
                        <c:gapWidth val="180"/>
                        <c:gapDepth val="220"/>
                        <c:shape val="coneToMax"/>
                    </c:bar3DChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let spec = project_chart_xml(xml);
    assert_eq!(spec.chart_type, domain_types::ChartType::Column3D);
    assert_eq!(spec.gap_width, Some(180));
    assert_eq!(spec.gap_depth, Some(220));
    assert_eq!(spec.bar_shape.as_deref(), Some("coneToMax"));
}

#[test]
fn test_parse_chart_title() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:title>
                    <c:tx>
                        <c:rich>
                            <a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                <a:r>
                                    <a:t>Sales Report</a:t>
                                </a:r>
                            </a:p>
                        </c:rich>
                    </c:tx>
                </c:title>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert!(chart.title.is_some());
    let title = chart.title.unwrap();
    assert_eq!(
        extract_chart_title_text(&title),
        Some("Sales Report".to_string())
    );
}

#[test]
fn test_parse_legend() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
                <c:legend>
                    <c:legendPos val="r"/>
                    <c:overlay val="0"/>
                </c:legend>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert!(chart.legend.is_some());
    let legend = chart.legend.unwrap();
    assert_eq!(legend.legend_pos, Some(LegendPosition::Right));
    assert_eq!(legend.overlay, Some(false));
}

#[test]
fn test_legend_position_from_ooxml() {
    assert_eq!(LegendPosition::from_ooxml("b"), LegendPosition::Bottom);
    assert_eq!(LegendPosition::from_ooxml("t"), LegendPosition::Top);
    assert_eq!(LegendPosition::from_ooxml("l"), LegendPosition::Left);
    assert_eq!(LegendPosition::from_ooxml("r"), LegendPosition::Right);
    assert_eq!(LegendPosition::from_ooxml("tr"), LegendPosition::TopRight);
    assert_eq!(LegendPosition::from_ooxml("unknown"), LegendPosition::Right);
}

#[test]
fn test_display_blanks_from_ooxml() {
    assert_eq!(DisplayBlanksAs::from_ooxml("gap"), DisplayBlanksAs::Gap);
    assert_eq!(DisplayBlanksAs::from_ooxml("span"), DisplayBlanksAs::Span);
    assert_eq!(DisplayBlanksAs::from_ooxml("zero"), DisplayBlanksAs::Zero);
    assert_eq!(
        DisplayBlanksAs::from_ooxml("unknown"),
        DisplayBlanksAs::Zero
    );
}

#[test]
fn test_parse_display_options() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
                <c:plotVisOnly val="1"/>
                <c:dispBlanksAs val="zero"/>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.display_options.plot_vis_only, Some(true));
    assert_eq!(
        chart.display_options.disp_blanks_as,
        Some(DisplayBlanksAs::Zero)
    );
}

#[test]
fn test_parse_scatter_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:scatterChart>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:scatterChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Scatter);
}

#[test]
fn test_parse_line_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:lineChart>
                        <c:grouping val="standard"/>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:lineChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Line);
}

#[test]
fn test_parse_area_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:areaChart>
                        <c:grouping val="stacked"/>
                    </c:areaChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Area);
}

#[test]
fn test_parse_doughnut_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:doughnutChart>
                        <c:holeSize val="50"/>
                    </c:doughnutChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Doughnut);
}

#[test]
fn test_parse_radar_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:radarChart>
                        <c:radarStyle val="marker"/>
                    </c:radarChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Radar);
}

#[test]
fn test_parse_surface_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:surfaceChart/>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Surface);
}

#[test]
fn test_parse_bubble_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:bubbleChart>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:bubbleChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Bubble);
}

#[test]
fn test_parse_stock_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:stockChart>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:stockChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Stock);
}

#[test]
fn test_parse_chart_with_data_table() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                    <c:dTable>
                        <c:showHorzBorder val="1"/>
                        <c:showVertBorder val="1"/>
                        <c:showOutline val="1"/>
                        <c:showKeys val="1"/>
                    </c:dTable>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert!(chart.plot_area.data_table.is_some());
    let dt = chart.plot_area.data_table.unwrap();
    assert_eq!(dt.show_horz_border, Some(true));
    assert_eq!(dt.show_vert_border, Some(true));
    assert_eq!(dt.show_outline, Some(true));
    assert_eq!(dt.show_keys, Some(true));
}

#[test]
fn test_parse_pivot_field_buttons() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
                <c:showAllFieldButtons val="1"/>
                <c:showAxisFieldButtons val="0"/>
                <c:showLegendFieldButtons/>
                <c:showValueFieldButtons val="1"/>
                <c:showReportFilterFieldButtons val="0"/>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.show_all_field_buttons, Some(true));
    assert_eq!(chart.show_axis_field_buttons, Some(false));
    assert_eq!(chart.show_legend_field_buttons, Some(true));
    assert_eq!(chart.show_value_field_buttons, Some(true));
    assert_eq!(chart.show_report_filter_field_buttons, Some(false));

    let spec = project_chart_xml(xml);
    assert_eq!(spec.show_all_field_buttons, Some(true));
    let pivot_options = spec.pivot_options.expect("pivot options");
    assert_eq!(pivot_options.show_axis_field_buttons, Some(false));
    assert_eq!(pivot_options.show_legend_field_buttons, Some(true));
    assert_eq!(pivot_options.show_value_field_buttons, Some(true));
    assert_eq!(pivot_options.show_report_filter_field_buttons, Some(false));
}

#[test]
fn test_parse_chart_print_settings_legacy_drawing_hf() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace
            xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
            <c:printSettings>
                <c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/>
                <c:legacyDrawingHF r:id="rIdHeaderFooterVml"/>
            </c:printSettings>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    let print_settings = chart.print_settings.expect("print settings");
    assert_eq!(
        print_settings.legacy_drawing_hf.as_deref(),
        Some("rIdHeaderFooterVml")
    );
}

#[test]
fn test_parse_legend_entries() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
                <c:legend>
                    <c:legendPos val="b"/>
                    <c:legendEntry>
                        <c:idx val="0"/>
                        <c:delete val="1"/>
                    </c:legendEntry>
                    <c:legendEntry>
                        <c:idx val="1"/>
                        <c:delete val="0"/>
                    </c:legendEntry>
                </c:legend>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert!(chart.legend.is_some());
    let legend = chart.legend.unwrap();
    assert_eq!(legend.legend_entry.len(), 2);
    assert_eq!(legend.legend_entry[0].idx, 0);
    assert_eq!(legend.legend_entry[0].delete, Some(true));
    assert_eq!(legend.legend_entry[1].idx, 1);
    assert_eq!(legend.legend_entry[1].delete, Some(false));
}

#[test]
fn test_chart_ref_default() {
    let chart_ref = ChartRef::default();
    assert!(chart_ref.r_id.is_empty());
    assert_eq!(chart_ref.chart_type, ChartType::Unknown);
}

#[test]
fn test_chart_anchor_default() {
    let anchor = ChartAnchor::default();
    assert_eq!(anchor.anchor_type, AnchorType::TwoCell);
    assert_eq!(anchor.from_col, 0);
    assert_eq!(anchor.from_row, 0);
}

#[test]
fn test_parse_combo_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                        <c:ser>
                            <c:idx val="0"/>
                            <c:order val="0"/>
                        </c:ser>
                    </c:barChart>
                    <c:lineChart>
                        <c:ser>
                            <c:idx val="1"/>
                            <c:order val="1"/>
                        </c:ser>
                    </c:lineChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Combo);
    assert_eq!(chart.series.len(), 2);
    assert_eq!(chart.series[0].idx, 0);
    assert_eq!(chart.series[1].idx, 1);
}

#[test]
fn test_parse_bar_chart_with_grouping_and_gap_width() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                        <c:grouping val="stacked"/>
                        <c:gapWidth val="200"/>
                        <c:overlap val="-50"/>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Bar);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::Bar(cfg) => {
            assert_eq!(cfg.grouping, Some(Grouping::Stacked));
            assert_eq!(cfg.gap_width, Some(200));
            assert_eq!(cfg.overlap, Some(-50));
            assert_eq!(cfg.bar_dir, BarDirection::Column);
        }
        _ => panic!("expected Bar config"),
    }
}

#[test]
fn test_parse_line_chart_with_drop_lines_and_up_down_bars() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:lineChart>
                        <c:grouping val="standard"/>
                        <c:dropLines/>
                        <c:upDownBars>
                            <c:gapWidth val="150"/>
                        </c:upDownBars>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:lineChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Line);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::Line(cfg) => {
            assert_eq!(cfg.grouping, Grouping::Standard);
            assert!(cfg.drop_lines.is_some());
            assert!(cfg.up_down_bars.is_some());
            let udb = cfg.up_down_bars.unwrap();
            assert_eq!(udb.gap_width, Some(150));
        }
        _ => panic!("expected Line config"),
    }
}

#[test]
fn test_parse_pie_chart_with_first_slice_ang() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:pieChart>
                        <c:varyColors val="1"/>
                        <c:firstSliceAng val="90"/>
                    </c:pieChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Pie);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::Pie(cfg) => {
            assert_eq!(cfg.first_slice_ang, Some(90));
            assert_eq!(cfg.vary_colors, Some(true));
        }
        _ => panic!("expected Pie config"),
    }
}

#[test]
fn test_parse_doughnut_chart_with_hole_size() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:doughnutChart>
                        <c:varyColors val="1"/>
                        <c:holeSize val="75"/>
                    </c:doughnutChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Doughnut);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::Doughnut(cfg) => {
            assert_eq!(cfg.hole_size, Some(75));
            assert_eq!(cfg.vary_colors, Some(true));
        }
        _ => panic!("expected Doughnut config"),
    }
}

#[test]
fn test_parse_scatter_chart_with_style() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:scatterChart>
                        <c:scatterStyle val="smoothMarker"/>
                        <c:varyColors val="0"/>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:scatterChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Scatter);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::Scatter(cfg) => {
            assert_eq!(cfg.scatter_style, ScatterStyle::SmoothMarker);
            assert_eq!(cfg.vary_colors, Some(false));
        }
        _ => panic!("expected Scatter config"),
    }
}

#[test]
fn test_parse_radar_chart_with_style() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:radarChart>
                        <c:radarStyle val="filled"/>
                        <c:varyColors val="0"/>
                    </c:radarChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Radar);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::Radar(cfg) => {
            assert_eq!(cfg.radar_style, RadarStyle::Filled);
            assert_eq!(cfg.vary_colors, Some(false));
        }
        _ => panic!("expected Radar config"),
    }
}

#[test]
fn test_parse_ofpie_chart() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:ofPieChart>
                        <c:ofPieType val="bar"/>
                        <c:gapWidth val="100"/>
                        <c:splitType val="percent"/>
                        <c:splitPos val="25"/>
                        <c:secondPieSize val="75"/>
                        <c:serLines/>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:ofPieChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::OfPie);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::OfPie(cfg) => {
            assert_eq!(cfg.of_pie_type, OfPieType::Bar);
            assert_eq!(cfg.gap_width, Some(100));
            assert_eq!(cfg.split_type, Some(SplitType::Percent));
            assert_eq!(cfg.split_pos, Some(25.0));
            assert_eq!(cfg.second_pie_size, Some(75));
            assert_eq!(cfg.ser_lines.len(), 1);
        }
        _ => panic!("expected OfPie config"),
    }
    assert_eq!(chart.series.len(), 1);
}

#[test]
fn test_parse_bubble_chart_with_config() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:bubbleChart>
                        <c:varyColors val="1"/>
                        <c:bubbleScale val="150"/>
                        <c:bubble3D val="1"/>
                        <c:showNegBubbles val="0"/>
                        <c:sizeRepresents val="w"/>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:bubbleChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.chart_type, ChartType::Bubble);
    let config = chart.chart_type_config.unwrap();
    match config {
        ChartTypeConfig::Bubble(cfg) => {
            assert_eq!(cfg.vary_colors, Some(true));
            assert_eq!(cfg.bubble_scale, Some(150));
            assert_eq!(cfg.bubble_3d, Some(true));
            assert_eq!(cfg.show_neg_bubbles, Some(false));
            assert_eq!(cfg.size_represents, Some(SizeRepresents::Width));
        }
        _ => panic!("expected Bubble config"),
    }
}

#[test]
fn test_project_bubble_chart_scalars() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:bubbleChart>
                        <c:bubbleScale val="150"/>
                        <c:bubble3D val="1"/>
                        <c:showNegBubbles val="0"/>
                        <c:sizeRepresents val="w"/>
                        <c:ser>
                            <c:idx val="0"/>
                        </c:ser>
                    </c:bubbleChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let spec = project_chart_xml(xml);

    assert_eq!(spec.bubble_scale, Some(150));
    assert_eq!(spec.bubble_3d_effect, Some(true));
    assert_eq!(spec.show_neg_bubbles, Some(false));
    assert_eq!(spec.size_represents.as_deref(), Some("w"));
}

#[test]
fn multi_level_category_ref_projects_levels_by_point_index() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:lineChart>
                        <c:ser>
                            <c:idx val="0"/>
                            <c:order val="0"/>
                            <c:cat>
                                <c:multiLvlStrRef>
                                    <c:f>Sheet1!$A$2:$B$4</c:f>
                                    <c:multiLvlStrCache>
                                        <c:ptCount val="3"/>
                                        <c:lvl>
                                            <c:ptCount val="3"/>
                                            <c:pt idx="0"><c:v>North</c:v></c:pt>
                                            <c:pt idx="2"><c:v>South</c:v></c:pt>
                                        </c:lvl>
                                        <c:lvl>
                                            <c:ptCount val="3"/>
                                            <c:pt idx="0"><c:v>Q1</c:v></c:pt>
                                            <c:pt idx="1"><c:v>Q2</c:v></c:pt>
                                        </c:lvl>
                                    </c:multiLvlStrCache>
                                </c:multiLvlStrRef>
                            </c:cat>
                            <c:val>
                                <c:numRef>
                                    <c:f>Sheet1!$C$2:$C$4</c:f>
                                    <c:numCache>
                                        <c:ptCount val="3"/>
                                        <c:pt idx="0"><c:v>10</c:v></c:pt>
                                        <c:pt idx="1"><c:v>20</c:v></c:pt>
                                        <c:pt idx="2"><c:v>30</c:v></c:pt>
                                    </c:numCache>
                                </c:numRef>
                            </c:val>
                        </c:ser>
                    </c:lineChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let spec = project_chart_xml(xml);
    let series = spec.series.first().expect("projected series");
    let levels = series
        .category_levels
        .as_ref()
        .expect("multi-level category cache");

    assert_eq!(series.categories.as_deref(), Some("Sheet1!$A$2:$B$4"));
    assert_eq!(
        series.category_source_kind,
        Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref)
    );
    assert!(series.category_cache.is_none());
    assert_eq!(levels.point_count, Some(3));
    assert_eq!(levels.levels.len(), 2);
    assert_eq!(levels.levels[0].level, 0);
    assert_eq!(levels.levels[0].point_count, Some(3));
    assert_eq!(levels.levels[0].points[1].idx, 2);
    assert_eq!(levels.levels[0].points[1].value, "South");
    assert_eq!(levels.levels[1].level, 1);
    assert_eq!(levels.levels[1].points[1].idx, 1);
    assert_eq!(levels.levels[1].points[1].value, "Q2");
}

#[test]
fn test_parse_view_3d() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:view3D>
                    <c:rotX val="30"/>
                    <c:rotY val="45"/>
                    <c:rAngAx val="1"/>
                    <c:perspective val="50"/>
                    <c:hPercent val="200"/>
                    <c:depthPercent val="150"/>
                </c:view3D>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert!(chart.view_3d.is_some());
    let v3d = chart.view_3d.unwrap();
    assert_eq!(v3d.rot_x, Some(30));
    assert_eq!(v3d.rot_y, Some(45));
    assert_eq!(v3d.right_angle_axes, Some(true));
    assert_eq!(v3d.perspective, Some(50));
    assert_eq!(v3d.height_percent, Some(200));
    assert_eq!(v3d.depth_percent, Some(150));
}

#[test]
fn test_parse_title_with_rich_text() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:chart>
                <c:title>
                    <c:tx>
                        <c:rich>
                            <a:bodyPr rot="0"/>
                            <a:p>
                                <a:r>
                                    <a:rPr lang="en-US" sz="1400" b="1"/>
                                    <a:t>Bold Title</a:t>
                                </a:r>
                            </a:p>
                        </c:rich>
                    </c:tx>
                    <c:overlay val="0"/>
                </c:title>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert!(chart.title.is_some());
    let title = chart.title.unwrap();
    assert_eq!(
        extract_chart_title_text(&title),
        Some("Bold Title".to_string())
    );
    // Rich text body should be captured
    match &title.tx {
        Some(TitleText::Rich(body)) => {
            assert_eq!(body.paragraphs.len(), 1);
        }
        _ => panic!("expected TitleText::Rich"),
    }
}

#[test]
fn test_parse_chart_level_dlbls() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                        <c:dLbls>
                            <c:showVal val="1"/>
                            <c:showCatName val="0"/>
                            <c:dLblPos val="outEnd"/>
                        </c:dLbls>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert!(chart.data_labels.is_some());
    let dlbls = chart.data_labels.unwrap();
    assert!(dlbls.show_value);
    assert!(!dlbls.show_category);
    assert_eq!(dlbls.position, DataLabelPosition::OutsideEnd);
}

#[test]
fn test_parse_auto_title_deleted() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:autoTitleDeleted val="1"/>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    assert_eq!(chart.auto_title_deleted, Some(true));
    // Must NOT have a chart title
    assert!(chart.title.is_none());
}

/// Regression: autoTitleDeleted with no chart title but axes have titles.
/// The parser must NOT pick up an axis title as the chart title.
#[test]
fn test_auto_title_deleted_with_axis_titles() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:chart>
                <c:autoTitleDeleted val="1"/>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                    <c:catAx>
                        <c:axId val="1"/>
                        <c:title>
                            <c:tx>
                                <c:rich>
                                    <a:p><a:r><a:t>Category Axis</a:t></a:r></a:p>
                                </c:rich>
                            </c:tx>
                        </c:title>
                        <c:scaling><c:orientation val="minMax"/></c:scaling>
                        <c:delete val="0"/>
                        <c:axPos val="b"/>
                        <c:crossAx val="2"/>
                    </c:catAx>
                    <c:valAx>
                        <c:axId val="2"/>
                        <c:title>
                            <c:tx>
                                <c:rich>
                                    <a:p><a:r><a:t>Value Axis</a:t></a:r></a:p>
                                </c:rich>
                            </c:tx>
                        </c:title>
                        <c:scaling><c:orientation val="minMax"/></c:scaling>
                        <c:delete val="0"/>
                        <c:axPos val="l"/>
                        <c:crossAx val="1"/>
                    </c:valAx>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);
    // Chart has autoTitleDeleted but no chart-level title
    assert_eq!(chart.auto_title_deleted, Some(true));
    assert!(
        chart.title.is_none(),
        "chart title must be None when only axes have titles"
    );
}

#[test]
fn test_parse_secondary_axes() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                    </c:barChart>
                    <c:catAx>
                        <c:axId val="123"/>
                        <c:axPos val="b"/>
                        <c:crossAx val="456"/>
                    </c:catAx>
                    <c:valAx>
                        <c:axId val="456"/>
                        <c:axPos val="l"/>
                        <c:crossAx val="123"/>
                    </c:valAx>
                    <c:catAx>
                        <c:axId val="789"/>
                        <c:axPos val="t"/>
                        <c:crossAx val="012"/>
                    </c:catAx>
                    <c:valAx>
                        <c:axId val="012"/>
                        <c:axPos val="r"/>
                        <c:crossAx val="789"/>
                    </c:valAx>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let chart = Chart::parse(xml);

    // Primary category axis (bottom position)
    assert!(chart.plot_area.cat_ax.is_some());
    let cat_ax = chart.plot_area.cat_ax.unwrap();
    assert_eq!(cat_ax.ax_id, 123);
    assert_eq!(cat_ax.ax_pos, ChartAxisPosition::Bottom);

    // Secondary category axis (top position)
    assert!(chart.plot_area.cat_ax_secondary.is_some());
    let cat_ax_sec = chart.plot_area.cat_ax_secondary.unwrap();
    assert_eq!(cat_ax_sec.ax_id, 789);
    assert_eq!(cat_ax_sec.ax_pos, ChartAxisPosition::Top);

    // Primary value axis (left position)
    assert!(chart.plot_area.val_ax.is_some());
    let val_ax = chart.plot_area.val_ax.unwrap();
    assert_eq!(val_ax.ax_id, 456);
    assert_eq!(val_ax.ax_pos, ChartAxisPosition::Left);

    // Secondary value axis (right position)
    assert!(chart.plot_area.val_ax_secondary.is_some());
    let val_ax_sec = chart.plot_area.val_ax_secondary.unwrap();
    assert_eq!(val_ax_sec.ax_id, 12); // Note: 012 parses as 12
    assert_eq!(val_ax_sec.ax_pos, ChartAxisPosition::Right);
}

#[test]
fn labels_markers_error_bars_and_no_fill_project_and_reconstruct() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:chart>
                <c:plotArea>
                    <c:lineChart>
                        <c:grouping val="standard"/>
                        <c:ser>
                            <c:idx val="0"/>
                            <c:order val="0"/>
                            <c:spPr>
                                <a:ln w="12700"><a:noFill/></a:ln>
                            </c:spPr>
                            <c:marker>
                                <c:symbol val="diamond"/>
                                <c:size val="9"/>
                                <c:spPr>
                                    <a:solidFill><a:srgbClr val="00AA00"/></a:solidFill>
                                    <a:ln><a:solidFill><a:srgbClr val="AA0000"/></a:solidFill></a:ln>
                                </c:spPr>
                            </c:marker>
                            <c:dPt>
                                <c:idx val="2"/>
                                <c:spPr>
                                    <a:ln><a:noFill/></a:ln>
                                </c:spPr>
                                <c:marker>
                                    <c:symbol val="triangle"/>
                                    <c:size val="7"/>
                                    <c:spPr>
                                        <a:solidFill><a:srgbClr val="0000AA"/></a:solidFill>
                                        <a:ln><a:solidFill><a:srgbClr val="AA00AA"/></a:solidFill></a:ln>
                                    </c:spPr>
                                </c:marker>
                            </c:dPt>
                            <c:dLbls>
                                <c:dLbl>
                                    <c:idx val="2"/>
                                    <c:tx>
                                        <c:rich>
                                            <a:bodyPr/>
                                            <a:p><a:r><a:t>Point Label</a:t></a:r></a:p>
                                        </c:rich>
                                    </c:tx>
                                    <c:numFmt formatCode="0.0" sourceLinked="0"/>
                                    <c:dLblPos val="t"/>
                                    <c:delete val="0"/>
                                    <c:showVal val="1"/>
                                </c:dLbl>
                                <c:showVal val="0"/>
                            </c:dLbls>
                            <c:errBars>
                                <c:errDir val="y"/>
                                <c:errBarType val="both"/>
                                <c:errValType val="cust"/>
                                <c:noEndCap val="1"/>
                                <c:plus>
                                    <c:numRef>
                                        <c:f>Sheet1!$C$2:$C$4</c:f>
                                        <c:numCache>
                                            <c:formatCode>General</c:formatCode>
                                            <c:ptCount val="2"/>
                                            <c:pt idx="0"><c:v>1.5</c:v></c:pt>
                                            <c:pt idx="1"><c:v>2.5</c:v></c:pt>
                                        </c:numCache>
                                    </c:numRef>
                                </c:plus>
                                <c:minus>
                                    <c:numLit>
                                        <c:ptCount val="2"/>
                                        <c:pt idx="0"><c:v>0.5</c:v></c:pt>
                                        <c:pt idx="1"><c:v>1.0</c:v></c:pt>
                                    </c:numLit>
                                </c:minus>
                            </c:errBars>
                            <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f></c:strRef></c:cat>
                            <c:val><c:numRef><c:f>Sheet1!$B$2:$B$4</c:f></c:numRef></c:val>
                        </c:ser>
                        <c:axId val="10"/>
                        <c:axId val="20"/>
                    </c:lineChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let spec = project_chart_xml(xml);
    let series = spec.series.first().expect("projected series");

    assert_eq!(
        series.marker_background_color,
        Some(domain_types::chart::ChartColorData::Hex(
            "00AA00".to_string()
        ))
    );
    assert_eq!(
        series.marker_foreground_color,
        Some(domain_types::chart::ChartColorData::Hex(
            "AA0000".to_string()
        ))
    );
    assert_eq!(
        series
            .format
            .as_ref()
            .and_then(|format| format.line.as_ref())
            .and_then(|line| line.no_fill),
        Some(true)
    );

    let point = series
        .points
        .as_ref()
        .and_then(|points| points.iter().find(|point| point.idx == 2))
        .expect("projected point override");
    assert_eq!(
        point.line_format.as_ref().and_then(|line| line.no_fill),
        Some(true)
    );
    assert_eq!(
        point.marker_background_color,
        Some(domain_types::chart::ChartColorData::Hex(
            "0000AA".to_string()
        ))
    );
    assert_eq!(
        point.marker_foreground_color,
        Some(domain_types::chart::ChartColorData::Hex(
            "AA00AA".to_string()
        ))
    );

    let label = point.data_label.as_ref().expect("projected point label");
    assert!(label.show);
    assert_eq!(label.delete, Some(false));
    assert_eq!(label.text.as_deref(), Some("Point Label"));
    assert_eq!(label.position.as_deref(), Some("top"));
    assert_eq!(label.show_value, Some(true));
    assert_eq!(label.number_format.as_deref(), Some("0.0"));
    assert_eq!(label.link_number_format, Some(false));

    let error_bars = series
        .y_error_bars
        .as_ref()
        .expect("projected y error bars");
    assert_eq!(error_bars.direction.as_deref(), Some("y"));
    assert_eq!(error_bars.bar_type.as_deref(), Some("both"));
    assert_eq!(error_bars.value_type.as_deref(), Some("cust"));
    assert_eq!(error_bars.no_end_cap, Some(true));
    let plus = error_bars
        .plus_source
        .as_ref()
        .expect("projected plus source");
    assert_eq!(plus.formula.as_deref(), Some("Sheet1!$C$2:$C$4"));
    assert_eq!(
        plus.cache.as_ref().and_then(|cache| cache.point_count),
        Some(2)
    );
    assert_eq!(plus.cache.as_ref().map(|cache| cache.points.len()), Some(2));
    let minus = error_bars
        .minus_source
        .as_ref()
        .expect("projected minus source");
    assert_eq!(minus.formula, None);
    assert_eq!(
        minus
            .cache
            .as_ref()
            .and_then(|cache| cache.points.first())
            .map(|point| point.value.as_str()),
        Some("0.5")
    );

    let reconstructed = reconstruct::reconstruct_chart_space(&spec);
    let out_series = reconstructed.chart.plot_area.chart_groups[0]
        .series
        .first()
        .expect("reconstructed series");
    let out_labels = out_series.d_lbls.as_ref().expect("reconstructed dLbls");
    assert!(out_series.d_lbl.is_empty());
    assert_eq!(out_labels.d_lbl.len(), 1);
    assert_eq!(out_labels.d_lbl[0].idx, 2);
    assert!(matches!(
        out_labels.d_lbl[0].text,
        Some(ooxml_types::charts::ChartText::Rich(_))
    ));
    assert_eq!(out_labels.d_lbl[0].delete, Some(false));
    assert_eq!(out_labels.d_lbl[0].show_value, Some(true));

    let out_marker = out_series.marker.as_ref().expect("reconstructed marker");
    let out_marker_sp = out_marker
        .sp_pr
        .as_ref()
        .expect("reconstructed marker spPr");
    assert_eq!(solid_fill_hex(out_marker_sp.fill.as_ref()), Some("00AA00"));
    assert_eq!(line_solid_hex(out_marker_sp.ln.as_ref()), Some("AA0000"));
    assert!(line_is_no_fill(
        out_series
            .sp_pr
            .as_ref()
            .and_then(|sp_pr| sp_pr.ln.as_ref())
    ));

    let out_point = out_series
        .d_pt
        .iter()
        .find(|point| point.idx == 2)
        .expect("reconstructed point override");
    assert!(line_is_no_fill(
        out_point.sp_pr.as_ref().and_then(|sp_pr| sp_pr.ln.as_ref())
    ));
    let out_point_marker_sp = out_point
        .marker
        .as_ref()
        .and_then(|marker| marker.sp_pr.as_ref())
        .expect("reconstructed point marker spPr");
    assert_eq!(
        solid_fill_hex(out_point_marker_sp.fill.as_ref()),
        Some("0000AA")
    );
    assert_eq!(
        line_solid_hex(out_point_marker_sp.ln.as_ref()),
        Some("AA00AA")
    );

    let out_error_bars = out_series
        .err_bars
        .iter()
        .find(|bars| bars.err_dir == Some(ooxml_types::charts::ErrorBarDirection::Y))
        .expect("reconstructed y error bars");
    match out_error_bars.plus.as_ref().expect("reconstructed plus") {
        ooxml_types::charts::NumDataSource::Ref(num_ref) => {
            assert_eq!(num_ref.f, "Sheet1!$C$2:$C$4");
            assert_eq!(
                num_ref.num_cache.as_ref().map(|cache| cache.pts.len()),
                Some(2)
            );
        }
        other => panic!("expected plus numRef, got {other:?}"),
    }
    match out_error_bars.minus.as_ref().expect("reconstructed minus") {
        ooxml_types::charts::NumDataSource::Lit(num_data) => {
            assert_eq!(num_data.pts.len(), 2);
            assert_eq!(num_data.pts[0].v, "0.5");
        }
        other => panic!("expected minus numLit, got {other:?}"),
    }
}

#[test]
fn line_analysis_fields_project_to_chart_data_and_reconstruct() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:chart>
                <c:plotArea>
                    <c:lineChart>
                        <c:grouping val="standard"/>
                        <c:ser><c:idx val="0"/><c:order val="0"/></c:ser>
                        <c:dropLines>
                            <c:spPr>
                                <a:ln w="25400">
                                    <a:solidFill><a:srgbClr val="112233"/></a:solidFill>
                                </a:ln>
                            </c:spPr>
                        </c:dropLines>
                        <c:hiLowLines>
                            <c:spPr>
                                <a:ln><a:noFill/></a:ln>
                            </c:spPr>
                        </c:hiLowLines>
                        <c:upDownBars>
                            <c:gapWidth val="219"/>
                            <c:upBars>
                                <c:spPr>
                                    <a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill>
                                </c:spPr>
                            </c:upBars>
                            <c:downBars>
                                <c:spPr>
                                    <a:solidFill><a:srgbClr val="123456"/></a:solidFill>
                                    <a:ln><a:solidFill><a:srgbClr val="654321"/></a:solidFill></a:ln>
                                </c:spPr>
                            </c:downBars>
                        </c:upDownBars>
                        <c:axId val="10"/>
                        <c:axId val="20"/>
                    </c:lineChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let spec = project_chart_xml(xml);

    let drop_lines = spec.drop_lines.as_ref().expect("drop lines");
    assert_eq!(drop_lines.visible, Some(true));
    assert_eq!(
        drop_lines
            .format
            .as_ref()
            .and_then(|line| line.color.clone()),
        Some(domain_types::chart::ChartColorData::Hex(
            "112233".to_string()
        ))
    );
    assert_eq!(
        drop_lines.format.as_ref().and_then(|line| line.width),
        Some(2.0)
    );
    assert_eq!(
        spec.high_low_lines
            .as_ref()
            .and_then(|lines| lines.format.as_ref())
            .and_then(|line| line.no_fill),
        Some(true)
    );

    let up_down_bars = spec.up_down_bars.as_ref().expect("up/down bars");
    assert_eq!(up_down_bars.gap_width, Some(219));
    assert_eq!(
        up_down_bars
            .up_format
            .as_ref()
            .and_then(|format| format.fill.clone()),
        Some(domain_types::chart::ChartFillData::Solid {
            color: domain_types::chart::ChartColorData::Hex("ABCDEF".to_string()),
            transparency: None,
        })
    );
    assert_eq!(
        up_down_bars
            .down_format
            .as_ref()
            .and_then(|format| format.line.as_ref())
            .and_then(|line| line.color.clone()),
        Some(domain_types::chart::ChartColorData::Hex(
            "654321".to_string()
        ))
    );

    match spec.to_floating_object("sheet-1", 0).data {
        domain_types::FloatingObjectData::Chart(chart_data) => {
            assert_eq!(chart_data.drop_lines, spec.drop_lines);
            assert_eq!(chart_data.high_low_lines, spec.high_low_lines);
            assert_eq!(chart_data.up_down_bars, spec.up_down_bars);
        }
        other => panic!("expected chart floating object, got {other:?}"),
    }

    let reconstructed = reconstruct::reconstruct_chart_space(&spec);
    let config = &reconstructed.chart.plot_area.chart_groups[0].config;
    let line_config = match config {
        ooxml_types::charts::ChartTypeConfig::Line(config) => config,
        other => panic!("expected line config, got {other:?}"),
    };
    let out_drop = line_config
        .drop_lines
        .as_ref()
        .and_then(|lines| lines.sp_pr.as_ref())
        .expect("reconstructed dropLines spPr");
    assert_eq!(line_solid_hex(out_drop.ln.as_ref()), Some("112233"));
    let out_high_low = line_config
        .hi_low_lines
        .as_ref()
        .and_then(|lines| lines.sp_pr.as_ref())
        .expect("reconstructed hiLowLines spPr");
    assert!(line_is_no_fill(out_high_low.ln.as_ref()));
    let out_up_down = line_config
        .up_down_bars
        .as_ref()
        .expect("reconstructed upDownBars");
    assert_eq!(out_up_down.gap_width, Some(219));
    assert_eq!(
        out_up_down
            .up_bars
            .as_ref()
            .and_then(|sp_pr| solid_fill_hex(sp_pr.fill.as_ref())),
        Some("ABCDEF")
    );
    assert_eq!(
        out_up_down
            .down_bars
            .as_ref()
            .and_then(|sp_pr| line_solid_hex(sp_pr.ln.as_ref())),
        Some("654321")
    );
}

#[test]
fn bar_series_lines_project_to_chart_data_and_reconstruct() {
    let xml = br#"<?xml version="1.0"?>
        <c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <c:chart>
                <c:plotArea>
                    <c:barChart>
                        <c:barDir val="col"/>
                        <c:grouping val="stacked"/>
                        <c:ser><c:idx val="0"/><c:order val="0"/></c:ser>
                        <c:serLines>
                            <c:spPr>
                                <a:ln w="19050">
                                    <a:solidFill><a:srgbClr val="FEDCBA"/></a:solidFill>
                                </a:ln>
                            </c:spPr>
                        </c:serLines>
                        <c:axId val="10"/>
                        <c:axId val="20"/>
                    </c:barChart>
                </c:plotArea>
            </c:chart>
        </c:chartSpace>"#;

    let spec = project_chart_xml(xml);

    let series_lines = spec.series_lines.as_ref().expect("series lines");
    assert_eq!(series_lines.visible, Some(true));
    assert_eq!(
        series_lines
            .format
            .as_ref()
            .and_then(|line| line.color.clone()),
        Some(domain_types::chart::ChartColorData::Hex(
            "FEDCBA".to_string()
        ))
    );
    assert_eq!(
        series_lines.format.as_ref().and_then(|line| line.width),
        Some(1.5)
    );

    match spec.to_floating_object("sheet-1", 0).data {
        domain_types::FloatingObjectData::Chart(chart_data) => {
            assert_eq!(chart_data.series_lines, spec.series_lines);
        }
        other => panic!("expected chart floating object, got {other:?}"),
    }

    let reconstructed = reconstruct::reconstruct_chart_space(&spec);
    let config = &reconstructed.chart.plot_area.chart_groups[0].config;
    let bar_config = match config {
        ooxml_types::charts::ChartTypeConfig::Bar(config) => config,
        other => panic!("expected bar config, got {other:?}"),
    };
    assert_eq!(bar_config.ser_lines.len(), 1);
    let out_series_lines = bar_config.ser_lines[0]
        .sp_pr
        .as_ref()
        .expect("reconstructed serLines spPr");
    assert_eq!(line_solid_hex(out_series_lines.ln.as_ref()), Some("FEDCBA"));
}
