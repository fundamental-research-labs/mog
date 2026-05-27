use super::*;

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
    assert!(chart.display_options.plot_vis_only);
    assert_eq!(chart.display_options.disp_blanks_as, DisplayBlanksAs::Zero);
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
