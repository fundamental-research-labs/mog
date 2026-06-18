use super::extract_series_from_chart_space;
use domain_types::chart::{ChartColorData, ChartDashStyle};
use ooxml_types::charts::{
    AreaChartConfig, AxisType, Chart, ChartAxis, ChartAxisPosition, ChartGroup, ChartLines,
    ChartSpace, ChartType, ChartTypeConfig, DataLabelOptions, DataPointOverride, ErrorBarDirection,
    ErrorBarType, ErrorBars, ErrorValueType, Line3DChartConfig, LineChartConfig, Marker,
    MarkerStyle, NumDataSource, PlotArea, RadarChartConfig, Scaling, ScatterChartConfig,
    ScatterStyle, StockChartConfig, Trendline, TrendlineType,
};
use ooxml_types::drawings::{EffectList, EffectProperties, OuterShadow, ShapeProperties};

fn axis(axis_type: AxisType, ax_id: u32, cross_ax: u32, ax_pos: ChartAxisPosition) -> ChartAxis {
    ChartAxis {
        axis_type,
        ax_id,
        cross_ax,
        ax_pos,
        scaling: Scaling::default(),
        ..Default::default()
    }
}

fn scatter_group(scatter_style: ScatterStyle, series_smooth: Option<bool>) -> ChartGroup {
    ChartGroup {
        chart_type: ChartType::Scatter,
        config: ChartTypeConfig::Scatter(ScatterChartConfig {
            scatter_style,
            ..Default::default()
        }),
        series: vec![ooxml_types::charts::ChartSeries {
            idx: 0,
            order: 0,
            smooth: series_smooth,
            ..Default::default()
        }],
        d_lbls: None,
        ax_id: vec![10, 20],
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
}

fn scatter_chart_space(scatter_style: ScatterStyle, series_smooth: Option<bool>) -> ChartSpace {
    ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![scatter_group(scatter_style, series_smooth)],
                axes: vec![
                    axis(AxisType::Value, 10, 20, ChartAxisPosition::Bottom),
                    axis(AxisType::Value, 20, 10, ChartAxisPosition::Left),
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }
}

fn area_group(ax_id: Vec<u32>) -> ChartGroup {
    ChartGroup {
        chart_type: ChartType::Area,
        config: ChartTypeConfig::Area(AreaChartConfig::default()),
        series: vec![ooxml_types::charts::ChartSeries {
            idx: 0,
            order: 0,
            ..Default::default()
        }],
        d_lbls: None,
        ax_id,
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
}

fn colored_line_group(chart_type: ChartType, config: ChartTypeConfig) -> ChartGroup {
    ChartGroup {
        chart_type,
        config,
        series: vec![ooxml_types::charts::ChartSeries {
            idx: 0,
            order: 0,
            sp_pr: Some(crate::domain::charts::parse_shape_properties(
                br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                    <a:ln><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:ln>
                </c:spPr>"#,
            )),
            ..Default::default()
        }],
        d_lbls: None,
        ax_id: vec![],
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
}

fn error_bars(direction: ErrorBarDirection) -> ErrorBars {
    ErrorBars {
        err_dir: Some(direction),
        err_bar_type: ErrorBarType::Both,
        err_val_type: ErrorValueType::FixedVal,
        val: Some(42.0),
        ..Default::default()
    }
}

fn group_with_error_bars(
    chart_type: ChartType,
    config: ChartTypeConfig,
    err_bars: Vec<ErrorBars>,
) -> ChartGroup {
    ChartGroup {
        chart_type,
        config,
        series: vec![ooxml_types::charts::ChartSeries {
            idx: 0,
            order: 0,
            err_bars,
            ..Default::default()
        }],
        d_lbls: None,
        ax_id: vec![],
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
}

#[test]
fn single_group_bound_to_secondary_axis_ids_preserves_y_axis_index() {
    let cs = ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![area_group(vec![30, 40])],
                axes: vec![
                    axis(AxisType::Category, 10, 20, ChartAxisPosition::Bottom),
                    axis(AxisType::Value, 20, 10, ChartAxisPosition::Left),
                    axis(AxisType::Category, 30, 40, ChartAxisPosition::Top),
                    axis(AxisType::Value, 40, 30, ChartAxisPosition::Right),
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    };

    let extracted = extract_series_from_chart_space(&cs);

    assert_eq!(extracted.len(), 1);
    assert_eq!(extracted[0].y_axis_index, Some(1));
}

#[test]
fn single_group_bound_only_to_secondary_category_keeps_primary_y_axis() {
    let cs = ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![area_group(vec![30, 20])],
                axes: vec![
                    axis(AxisType::Category, 10, 20, ChartAxisPosition::Bottom),
                    axis(AxisType::Value, 20, 10, ChartAxisPosition::Left),
                    axis(AxisType::Category, 30, 20, ChartAxisPosition::Top),
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    };

    let extracted = extract_series_from_chart_space(&cs);

    assert_eq!(extracted.len(), 1);
    assert_eq!(extracted[0].y_axis_index, None);
}

#[test]
fn line_family_legacy_series_color_comes_from_line_format() {
    for (chart_type, config) in [
        (
            ChartType::Line,
            ChartTypeConfig::Line(LineChartConfig::default()),
        ),
        (
            ChartType::Line3D,
            ChartTypeConfig::Line3D(Line3DChartConfig::default()),
        ),
        (
            ChartType::Radar,
            ChartTypeConfig::Radar(RadarChartConfig::default()),
        ),
        (
            ChartType::Stock,
            ChartTypeConfig::Stock(StockChartConfig::default()),
        ),
    ] {
        let extracted = extract_series_from_chart_space(&ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    chart_groups: vec![colored_line_group(chart_type, config)],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        });

        assert_eq!(extracted[0].color.as_deref(), Some("4472C4"));
    }
}

#[test]
fn series_shadow_effect_extracts_show_shadow() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Area,
                    config: ChartTypeConfig::Area(AreaChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        sp_pr: Some(ShapeProperties {
                            effects: Some(EffectProperties::EffectList(EffectList {
                                outer_shadow: Some(OuterShadow::default()),
                                ..Default::default()
                            })),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    assert_eq!(extracted[0].show_shadow, Some(true));
}

#[test]
fn trendline_properties_extract_to_public_type_and_line_aliases() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Scatter,
                    config: ChartTypeConfig::Scatter(ScatterChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        trendline: vec![Trendline {
                            trendline_type: TrendlineType::Exponential,
                            sp_pr: Some(crate::domain::charts::parse_shape_properties(
                                br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                    <a:ln w="38100">
                                        <a:solidFill><a:srgbClr val="FFC000"/></a:solidFill>
                                    </a:ln>
                                </c:spPr>"#,
                            )),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                axes: vec![
                    axis(AxisType::Value, 10, 20, ChartAxisPosition::Bottom),
                    axis(AxisType::Value, 20, 10, ChartAxisPosition::Left),
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    let trendline = extracted[0]
        .trendlines
        .as_ref()
        .and_then(|trendlines| trendlines.first())
        .expect("trendline");
    assert_eq!(trendline.show, Some(true));
    assert_eq!(trendline.r#type.as_deref(), Some("exponential"));
    assert_eq!(trendline.color.as_deref(), Some("FFC000"));
    assert_eq!(trendline.line_width, Some(3.0));
    assert_eq!(
        trendline.line_format.as_ref().and_then(|line| line.width),
        Some(3.0)
    );
}

#[test]
fn standard_chart_y_error_bars_extract_to_general_slot() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![group_with_error_bars(
                    ChartType::Area,
                    ChartTypeConfig::Area(AreaChartConfig::default()),
                    vec![error_bars(ErrorBarDirection::Y)],
                )],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    assert_eq!(
        extracted[0]
            .error_bars
            .as_ref()
            .and_then(|bars| bars.direction.as_deref()),
        Some("y")
    );
    assert_eq!(
        extracted[0]
            .error_bars
            .as_ref()
            .and_then(|bars| bars.visible),
        Some(true)
    );
    assert!(extracted[0].x_error_bars.is_none());
    assert!(extracted[0].y_error_bars.is_none());
}

#[test]
fn xy_chart_error_bars_extract_to_directional_slots() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![group_with_error_bars(
                    ChartType::Scatter,
                    ChartTypeConfig::Scatter(ScatterChartConfig::default()),
                    vec![
                        error_bars(ErrorBarDirection::X),
                        error_bars(ErrorBarDirection::Y),
                    ],
                )],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    assert!(extracted[0].error_bars.is_none());
    assert_eq!(
        extracted[0]
            .x_error_bars
            .as_ref()
            .and_then(|bars| bars.direction.as_deref()),
        Some("x")
    );
    assert_eq!(
        extracted[0]
            .y_error_bars
            .as_ref()
            .and_then(|bars| bars.direction.as_deref()),
        Some("y")
    );
}

#[test]
fn point_shape_properties_extract_to_format_aliases() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Area,
                    config: ChartTypeConfig::Area(AreaChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        d_pt: vec![DataPointOverride {
                            idx: 0,
                            sp_pr: Some(crate::domain::charts::parse_shape_properties(
                                br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                    <a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill>
                                    <a:ln w="25400">
                                        <a:solidFill><a:srgbClr val="A5A5A5"/></a:solidFill>
                                        <a:prstDash val="dash"/>
                                    </a:ln>
                                </c:spPr>"#,
                            )),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    let point = extracted[0]
        .points
        .as_ref()
        .and_then(|points| points.first())
        .expect("point format");
    assert_eq!(point.fill.as_deref(), Some("ED7D31"));
    assert_eq!(
        point
            .border
            .as_ref()
            .and_then(|border| border.color.as_deref()),
        Some("A5A5A5")
    );
    assert_eq!(
        point.border.as_ref().and_then(|border| border.width),
        Some(2.0)
    );
    assert_eq!(
        point
            .border
            .as_ref()
            .and_then(|border| border.style.as_deref()),
        Some("dash")
    );
    assert_eq!(
        point
            .line_format
            .as_ref()
            .and_then(|line| line.color.as_ref()),
        Some(&ChartColorData::Hex("A5A5A5".to_string()))
    );
    assert_eq!(
        point
            .line_format
            .as_ref()
            .and_then(|line| line.dash_style.as_ref()),
        Some(&ChartDashStyle::Dash)
    );
}

#[test]
fn series_marker_outline_extracts_width_and_dash_without_line_color() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Line,
                    config: ChartTypeConfig::Line(LineChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        marker: Some(Marker {
                            symbol: Some(MarkerStyle::Circle),
                            sp_pr: Some(crate::domain::charts::parse_shape_properties(
                                br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                    <a:ln w="25400"><a:prstDash val="solid"/></a:ln>
                                </c:spPr>"#,
                            )),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    let line = extracted[0]
        .marker_line_format
        .as_ref()
        .expect("marker line format");
    assert_eq!(line.width, Some(2.0));
    assert_eq!(line.dash_style, Some(ChartDashStyle::Solid));
}

#[test]
fn point_marker_outline_extracts_width_and_dash_without_line_color() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Line,
                    config: ChartTypeConfig::Line(LineChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        d_pt: vec![DataPointOverride {
                            idx: 0,
                            marker: Some(Marker {
                                symbol: Some(MarkerStyle::Circle),
                                sp_pr: Some(crate::domain::charts::parse_shape_properties(
                                    br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                        <a:ln w="25400"><a:prstDash val="solid"/></a:ln>
                                    </c:spPr>"#,
                                )),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    let point = extracted[0]
        .points
        .as_ref()
        .and_then(|points| points.first())
        .expect("point format");
    let line = point
        .marker_line_format
        .as_ref()
        .expect("marker line format");
    assert_eq!(line.width, Some(2.0));
    assert_eq!(line.dash_style, Some(ChartDashStyle::Solid));
}

#[test]
fn bubble_sized_series_error_bars_extract_to_directional_slots() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Bar,
                    config: ChartTypeConfig::Bar(Default::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        bubble_size: Some(NumDataSource::Lit(Default::default())),
                        err_bars: vec![error_bars(ErrorBarDirection::Y)],
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    assert!(extracted[0].error_bars.is_none());
    assert_eq!(
        extracted[0]
            .y_error_bars
            .as_ref()
            .and_then(|bars| bars.direction.as_deref()),
        Some("y")
    );
}

#[test]
fn series_data_label_leader_lines_extract_to_series_alias() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Pie,
                    config: ChartTypeConfig::Pie(Default::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        d_lbls: Some(DataLabelOptions {
                            show_leader_lines: Some(true),
                            leader_lines: Some(ChartLines {
                                sp_pr: Some(crate::domain::charts::parse_shape_properties(
                                    br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                        <a:ln w="25400"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:ln>
                                    </c:spPr>"#,
                                )),
                            }),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    assert_eq!(extracted[0].show_leader_lines, Some(true));
    assert_eq!(
        extracted[0]
            .leader_line_format
            .as_ref()
            .and_then(|format| format.line.as_ref())
            .and_then(|line| line.color.clone()),
        Some(domain_types::chart::ChartColorData::Hex(
            "00FF00".to_string()
        ))
    );
}

#[test]
fn series_data_label_visual_line_no_fill_extracts_from_series_options() {
    let extracted = extract_series_from_chart_space(&ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: ChartType::Area,
                    config: ChartTypeConfig::Area(AreaChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        d_lbls: Some(DataLabelOptions {
                            sp_pr: Some(crate::domain::charts::parse_shape_properties(
                                br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                                    <a:ln><a:noFill/></a:ln>
                                </c:spPr>"#,
                            )),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    });

    assert_eq!(
        extracted[0]
            .data_labels
            .as_ref()
            .and_then(|labels| labels.visual_format.as_ref())
            .and_then(|format| format.line.as_ref())
            .and_then(|line| line.no_fill),
        Some(true)
    );
}

#[test]
fn scatter_style_does_not_materialize_absent_series_smooth() {
    let extracted = extract_series_from_chart_space(&scatter_chart_space(ScatterStyle::Line, None));

    assert_eq!(extracted.len(), 1);
    assert_eq!(extracted[0].smooth, None);
    assert_eq!(extracted[0].show_lines, Some(true));
    assert_eq!(extracted[0].show_markers, None);
}

#[test]
fn scatter_marker_style_does_not_materialize_absent_series_markers() {
    let extracted =
        extract_series_from_chart_space(&scatter_chart_space(ScatterStyle::LineMarker, None));

    assert_eq!(extracted.len(), 1);
    assert_eq!(extracted[0].show_lines, Some(true));
    assert_eq!(extracted[0].show_markers, None);
}

#[test]
fn preserves_explicit_series_smooth_for_scatter() {
    let extracted =
        extract_series_from_chart_space(&scatter_chart_space(ScatterStyle::Line, Some(false)));

    assert_eq!(extracted.len(), 1);
    assert_eq!(extracted[0].smooth, Some(false));
}
