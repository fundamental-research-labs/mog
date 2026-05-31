use super::axes::resolve_group_y_axis_index;
use super::common::map_ooxml_chart_type_to_domain;
use super::data_refs::{extract_cat_ref_formula, extract_num_ref_formula};
use super::formatting::{extract_chart_format, extract_chart_line, extract_fill_color};
use super::labels::{extract_data_label_data, extract_individual_data_label_data};
use super::markers::extract_marker_config;
use super::text::extract_chart_text_string;
use std::collections::BTreeMap;

pub(super) fn extract_series_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Vec<domain_types::chart::ChartSeriesData> {
    let plot_area = &cs.chart.plot_area;
    let is_combo = plot_area.chart_groups.len() > 1;
    plot_area
        .chart_groups
        .iter()
        .flat_map(|g| {
            let series_type = if is_combo {
                Some(map_ooxml_chart_type_to_domain(g.chart_type, &g.config))
            } else {
                None
            };
            let y_axis_index =
                resolve_group_y_axis_index(&plot_area.axes, &plot_area.chart_groups, g);
            g.series
                .iter()
                .map(move |s| extract_single_series(s, series_type.clone(), y_axis_index))
        })
        .collect()
}

/// Extract a single series from an ooxml ChartSeries.
pub(super) fn extract_single_series(
    s: &ooxml_types::charts::ChartSeries,
    series_type: Option<domain_types::ChartType>,
    y_axis_index: Option<u8>,
) -> domain_types::chart::ChartSeriesData {
    use ooxml_types::charts::SeriesTextSource;

    // Name
    let name =
        s.tx.as_ref()
            .and_then(|tx| match tx {
                SeriesTextSource::Value(v) => Some(v.clone()),
                SeriesTextSource::StrRef(sr) => sr
                    .str_cache
                    .as_ref()
                    .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
            })
            .or_else(|| Some(default_series_name(s.idx, s.order)));

    // Legacy fill color
    let color = s.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));

    // Values range: val (standard) or y_val (scatter/bubble)
    let values = extract_num_ref_formula(&s.val).or_else(|| extract_num_ref_formula(&s.y_val));
    let value_cache = extract_num_point_cache(&s.val).or_else(|| extract_num_point_cache(&s.y_val));

    // Categories range: cat (standard) or x_val (scatter/bubble)
    let categories = extract_cat_ref_formula(&s.cat).or_else(|| extract_cat_ref_formula(&s.x_val));
    let category_cache =
        extract_cat_point_cache(&s.cat).or_else(|| extract_cat_point_cache(&s.x_val));
    let category_levels =
        extract_cat_level_cache(&s.cat).or_else(|| extract_cat_level_cache(&s.x_val));
    let category_label_format =
        extract_category_label_format(&s.cat).or_else(|| extract_category_label_format(&s.x_val));

    let bubble_size = extract_num_ref_formula(&s.bubble_size);
    let bubble_size_cache = extract_num_point_cache(&s.bubble_size);

    // Markers
    let (show_markers, marker_size, marker_style, marker_background_color, marker_foreground_color) =
        extract_marker_config(&s.marker);

    // Per-point formatting
    let mut point_formats: BTreeMap<u32, domain_types::chart::PointFormatData> = BTreeMap::new();
    for pt in &s.d_pt {
        let fill = pt.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));
        let visual_format = extract_chart_format(pt.sp_pr.as_ref(), None);
        let line_format = pt
            .sp_pr
            .as_ref()
            .and_then(|sp| sp.ln.as_ref())
            .map(|ln| extract_chart_line(ln));
        let (
            _point_show_markers,
            point_marker_size,
            point_marker_style,
            point_marker_background_color,
            point_marker_foreground_color,
        ) = extract_marker_config(&pt.marker);
        let entry = point_formats
            .entry(pt.idx)
            .or_insert_with(|| point_format(pt.idx));
        entry.invert_if_negative = pt.invert_if_negative;
        entry.explosion = pt.explosion;
        entry.bubble_3d = pt.bubble_3d;
        entry.fill = fill;
        entry.line_format = line_format;
        entry.visual_format = visual_format;
        entry.marker_size = point_marker_size;
        entry.marker_style = point_marker_style;
        entry.marker_background_color = point_marker_background_color;
        entry.marker_foreground_color = point_marker_foreground_color;
    }
    let labels_from_options = s.d_lbls.iter().flat_map(|labels| labels.d_lbl.iter());
    for label in labels_from_options.chain(s.d_lbl.iter()) {
        let entry = point_formats
            .entry(label.idx)
            .or_insert_with(|| point_format(label.idx));
        entry.data_label = Some(extract_individual_data_label_data(label, s.d_lbls.as_ref()));
    }
    let points = (!point_formats.is_empty()).then(|| point_formats.into_values().collect());

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
        r#type: series_type,
        color,
        values,
        value_cache,
        categories,
        category_cache,
        category_levels,
        category_label_format,
        bubble_size,
        bubble_size_cache,
        smooth: s.smooth,
        explosion: s.explosion,
        invert_if_negative: s.invert_if_negative,
        y_axis_index,
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
        marker_background_color,
        marker_foreground_color,
        filtered: None,
        show_shadow: None,
        show_connector_lines: None,
        leader_line_format: None,
        show_leader_lines: None,
    }
}

fn point_format(idx: u32) -> domain_types::chart::PointFormatData {
    domain_types::chart::PointFormatData {
        idx,
        invert_if_negative: None,
        explosion: None,
        bubble_3d: None,
        fill: None,
        border: None,
        line_format: None,
        data_label: None,
        visual_format: None,
        marker_background_color: None,
        marker_foreground_color: None,
        marker_size: None,
        marker_style: None,
    }
}

fn default_series_name(idx: u32, order: u32) -> String {
    let ordinal = if idx > 0 { idx } else { order + 1 };
    format!("Series {ordinal}")
}

fn extract_num_point_cache(
    src: &Option<ooxml_types::charts::NumDataSource>,
) -> Option<domain_types::chart::ChartSeriesPointCacheData> {
    use ooxml_types::charts::NumDataSource;

    let data = match src.as_ref()? {
        NumDataSource::Ref(num_ref) => num_ref.num_cache.as_ref()?,
        NumDataSource::Lit(num_data) => num_data,
    };
    Some(num_data_to_point_cache(data))
}

fn extract_cat_point_cache(
    src: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::ChartSeriesPointCacheData> {
    use ooxml_types::charts::CatDataSource;

    match src.as_ref()? {
        CatDataSource::NumRef(num_ref) => num_ref.num_cache.as_ref().map(num_data_to_point_cache),
        CatDataSource::NumLit(num_data) => Some(num_data_to_point_cache(num_data)),
        CatDataSource::StrRef(str_ref) => str_ref.str_cache.as_ref().map(str_data_to_point_cache),
        CatDataSource::StrLit(str_data) => Some(str_data_to_point_cache(str_data)),
        CatDataSource::MultiLvlStrRef(_) => None,
    }
}

fn extract_cat_level_cache(
    src: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::ChartSeriesCategoryLevelsCacheData> {
    use ooxml_types::charts::CatDataSource;

    match src.as_ref()? {
        CatDataSource::MultiLvlStrRef(multi_lvl_ref) => multi_lvl_ref
            .multi_lvl_str_cache
            .as_ref()
            .map(multi_lvl_str_data_to_category_levels_cache),
        _ => None,
    }
}

fn multi_lvl_str_data_to_category_levels_cache(
    data: &ooxml_types::charts::MultiLvlStrData,
) -> domain_types::chart::ChartSeriesCategoryLevelsCacheData {
    domain_types::chart::ChartSeriesCategoryLevelsCacheData {
        point_count: data.pt_count,
        levels: data
            .levels
            .iter()
            .enumerate()
            .map(
                |(level, level_data)| domain_types::chart::ChartSeriesCategoryLevelCacheData {
                    level: level as u32,
                    point_count: level_data.pt_count,
                    points: level_data
                        .pts
                        .iter()
                        .map(
                            |point| domain_types::chart::ChartSeriesPointCachePointData {
                                idx: point.idx,
                                value: point.v.clone(),
                                format_code: None,
                            },
                        )
                        .collect(),
                },
            )
            .collect(),
    }
}

fn num_data_to_point_cache(
    data: &ooxml_types::charts::NumData,
) -> domain_types::chart::ChartSeriesPointCacheData {
    domain_types::chart::ChartSeriesPointCacheData {
        point_count: data.pt_count,
        format_code: data.format_code.clone(),
        points: data
            .pts
            .iter()
            .map(
                |point| domain_types::chart::ChartSeriesPointCachePointData {
                    idx: point.idx,
                    value: point.v.clone(),
                    format_code: point.format_code.clone(),
                },
            )
            .collect(),
    }
}

fn str_data_to_point_cache(
    data: &ooxml_types::charts::StrData,
) -> domain_types::chart::ChartSeriesPointCacheData {
    domain_types::chart::ChartSeriesPointCacheData {
        point_count: data.pt_count,
        format_code: None,
        points: data
            .pts
            .iter()
            .map(
                |point| domain_types::chart::ChartSeriesPointCachePointData {
                    idx: point.idx,
                    value: point.v.clone(),
                    format_code: None,
                },
            )
            .collect(),
    }
}

fn extract_category_label_format(
    cat: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::CategoryLabelFormatData> {
    use ooxml_types::charts::CatDataSource;

    let num_data = match cat {
        Some(CatDataSource::NumRef(num_ref)) => num_ref.num_cache.as_ref(),
        Some(CatDataSource::NumLit(num_data)) => Some(num_data),
        _ => None,
    }?;

    let points: Vec<domain_types::chart::CategoryPointLabelFormatData> = num_data
        .pts
        .iter()
        .filter_map(|point| {
            point.format_code.as_ref().map(|format_code| {
                domain_types::chart::CategoryPointLabelFormatData {
                    idx: point.idx,
                    format_code: Some(format_code.clone()),
                }
            })
        })
        .collect();

    if num_data.format_code.is_none() && points.is_empty() {
        return None;
    }

    Some(domain_types::chart::CategoryLabelFormatData {
        format_code: num_data.format_code.clone(),
        points: if points.is_empty() {
            None
        } else {
            Some(points)
        },
    })
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
            plus_source: eb.plus.as_ref().map(num_data_source_to_error_bar_source),
            minus_source: eb.minus.as_ref().map(num_data_source_to_error_bar_source),
        };
        match eb.err_dir {
            Some(ooxml_types::charts::ErrorBarDirection::X) => x_bars = Some(data),
            Some(ooxml_types::charts::ErrorBarDirection::Y) => y_bars = Some(data),
            None => general = Some(data),
        }
    }

    (general, x_bars, y_bars)
}

fn num_data_source_to_error_bar_source(
    src: &ooxml_types::charts::NumDataSource,
) -> domain_types::chart::ErrorBarSourceData {
    use ooxml_types::charts::NumDataSource;

    match src {
        NumDataSource::Ref(num_ref) => domain_types::chart::ErrorBarSourceData {
            formula: Some(num_ref.f.clone()),
            cache: num_ref.num_cache.as_ref().map(num_data_to_point_cache),
        },
        NumDataSource::Lit(num_data) => domain_types::chart::ErrorBarSourceData {
            formula: None,
            cache: Some(num_data_to_point_cache(num_data)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::charts::{
        AxisType, BarChartConfig, CatDataSource, Chart, ChartAxis, ChartAxisPosition, ChartGroup,
        ChartSpace, ChartText, ChartType, ChartTypeConfig, DataLabel, DataLabelOptions,
        DataLabelPosition, LineChartConfig, MultiLvlStrData, MultiLvlStrRef, NumData,
        NumDataSource, NumPoint, NumRef, PlotArea, Scaling, StrData, StrPoint,
    };

    fn axis(
        axis_type: AxisType,
        ax_id: u32,
        cross_ax: u32,
        ax_pos: ChartAxisPosition,
    ) -> ChartAxis {
        ChartAxis {
            axis_type,
            ax_id,
            cross_ax,
            ax_pos,
            scaling: Scaling::default(),
            ..Default::default()
        }
    }

    fn group(
        chart_type: ChartType,
        config: ChartTypeConfig,
        ax_id: Vec<u32>,
        series: Vec<ooxml_types::charts::ChartSeries>,
    ) -> ChartGroup {
        ChartGroup {
            chart_type,
            config,
            series,
            d_lbls: None,
            ax_id,
            raw_chart_type_attr: None,
            raw_chart_element_name: None,
            raw_chart_group_xml: None,
        }
    }

    #[test]
    fn extracts_category_cache_format_and_point_overrides() {
        let cat = Some(CatDataSource::NumRef(NumRef {
            f: "Sheet1!$A$1:$C$1".to_string(),
            num_cache: Some(NumData {
                format_code: Some("\"FY3/\"0".to_string()),
                pt_count: Some(3),
                pts: vec![
                    NumPoint {
                        idx: 0,
                        v: "24".to_string(),
                        format_code: None,
                    },
                    NumPoint {
                        idx: 1,
                        v: "25".to_string(),
                        format_code: Some("\"FY3/\"0\"E\"".to_string()),
                    },
                ],
                extensions: vec![],
            }),
            extensions: vec![],
        }));

        let format = extract_category_label_format(&cat).expect("category format");

        assert_eq!(format.format_code.as_deref(), Some("\"FY3/\"0"));
        assert_eq!(
            format.points.as_ref().and_then(|points| points.first()),
            Some(&domain_types::chart::CategoryPointLabelFormatData {
                idx: 1,
                format_code: Some("\"FY3/\"0\"E\"".to_string()),
            }),
        );
    }

    #[test]
    fn preserves_value_cache_point_indices_and_explicit_zeroes() {
        let series = ooxml_types::charts::ChartSeries {
            val: Some(NumDataSource::Ref(NumRef {
                f: "Sheet1!$B$2:$B$5".to_string(),
                num_cache: Some(NumData {
                    format_code: Some("General".to_string()),
                    pt_count: Some(4),
                    pts: vec![
                        NumPoint {
                            idx: 2,
                            v: "0".to_string(),
                            format_code: Some("0%".to_string()),
                        },
                        NumPoint {
                            idx: 3,
                            v: "4.5".to_string(),
                            format_code: None,
                        },
                    ],
                    extensions: vec![],
                }),
                extensions: vec![],
            })),
            ..Default::default()
        };

        let extracted = extract_single_series(&series, None, None);
        let cache = extracted.value_cache.expect("value cache");

        assert_eq!(cache.point_count, Some(4));
        assert_eq!(cache.format_code.as_deref(), Some("General"));
        assert_eq!(cache.points.len(), 2);
        assert_eq!(cache.points[0].idx, 2);
        assert_eq!(cache.points[0].value, "0");
        assert_eq!(cache.points[0].format_code.as_deref(), Some("0%"));
    }

    #[test]
    fn preserves_category_and_bubble_cache_metadata() {
        let series = ooxml_types::charts::ChartSeries {
            cat: Some(CatDataSource::NumRef(NumRef {
                f: "Sheet1!$A$2:$A$3".to_string(),
                num_cache: Some(NumData {
                    format_code: Some("m/d/yyyy".to_string()),
                    pt_count: Some(2),
                    pts: vec![NumPoint {
                        idx: 1,
                        v: "45292".to_string(),
                        format_code: Some("m/d/yy".to_string()),
                    }],
                    extensions: vec![],
                }),
                extensions: vec![],
            })),
            bubble_size: Some(NumDataSource::Ref(NumRef {
                f: "Sheet1!$C$2:$C$3".to_string(),
                num_cache: Some(NumData {
                    format_code: Some("General".to_string()),
                    pt_count: Some(2),
                    pts: vec![NumPoint {
                        idx: 0,
                        v: "10".to_string(),
                        format_code: None,
                    }],
                    extensions: vec![],
                }),
                extensions: vec![],
            })),
            ..Default::default()
        };

        let extracted = extract_single_series(&series, None, None);
        let category_cache = extracted.category_cache.expect("category cache");
        let bubble_size_cache = extracted.bubble_size_cache.expect("bubble size cache");

        assert_eq!(category_cache.point_count, Some(2));
        assert_eq!(category_cache.format_code.as_deref(), Some("m/d/yyyy"));
        assert_eq!(category_cache.points[0].idx, 1);
        assert_eq!(
            category_cache.points[0].format_code.as_deref(),
            Some("m/d/yy")
        );
        assert_eq!(bubble_size_cache.point_count, Some(2));
        assert_eq!(bubble_size_cache.points[0].value, "10");
    }

    #[test]
    fn preserves_multi_level_category_cache_by_point_index() {
        let series = ooxml_types::charts::ChartSeries {
            cat: Some(CatDataSource::MultiLvlStrRef(MultiLvlStrRef {
                f: "Sheet1!$A$2:$B$4".to_string(),
                multi_lvl_str_cache: Some(MultiLvlStrData {
                    pt_count: Some(3),
                    levels: vec![
                        StrData {
                            pt_count: Some(3),
                            pts: vec![
                                StrPoint {
                                    idx: 0,
                                    v: "North".to_string(),
                                },
                                StrPoint {
                                    idx: 2,
                                    v: "South".to_string(),
                                },
                            ],
                            extensions: vec![],
                        },
                        StrData {
                            pt_count: Some(3),
                            pts: vec![
                                StrPoint {
                                    idx: 0,
                                    v: "Q1".to_string(),
                                },
                                StrPoint {
                                    idx: 1,
                                    v: "Q2".to_string(),
                                },
                            ],
                            extensions: vec![],
                        },
                    ],
                    extensions: vec![],
                }),
                extensions: vec![],
            })),
            ..Default::default()
        };

        let extracted = extract_single_series(&series, None, None);
        let levels = extracted.category_levels.expect("category levels");

        assert_eq!(extracted.categories.as_deref(), Some("Sheet1!$A$2:$B$4"));
        assert!(extracted.category_cache.is_none());
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
    fn assigns_series_y_axis_index_from_combo_group_axis_ids() {
        let cs = ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    chart_groups: vec![
                        group(
                            ChartType::Line,
                            ChartTypeConfig::Line(LineChartConfig::default()),
                            vec![10, 20],
                            vec![ooxml_types::charts::ChartSeries {
                                idx: 0,
                                order: 0,
                                ..Default::default()
                            }],
                        ),
                        group(
                            ChartType::Bar,
                            ChartTypeConfig::Bar(BarChartConfig::default()),
                            vec![10, 30],
                            vec![ooxml_types::charts::ChartSeries {
                                idx: 1,
                                order: 1,
                                ..Default::default()
                            }],
                        ),
                    ],
                    axes: vec![
                        axis(AxisType::Category, 10, 20, ChartAxisPosition::Bottom),
                        axis(AxisType::Value, 20, 10, ChartAxisPosition::Left),
                        axis(AxisType::Value, 30, 10, ChartAxisPosition::Right),
                    ],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };

        let extracted = extract_series_from_chart_space(&cs);

        assert_eq!(extracted.len(), 2);
        assert_eq!(extracted[0].y_axis_index, Some(0));
        assert_eq!(extracted[1].y_axis_index, Some(1));
    }

    #[test]
    fn projects_individual_data_labels_as_point_overrides() {
        let series = ooxml_types::charts::ChartSeries {
            d_lbls: Some(DataLabelOptions {
                show_value: true,
                position: DataLabelPosition::OutsideEnd,
                separator: Some("; ".to_string()),
                ..Default::default()
            }),
            d_lbl: vec![DataLabel {
                idx: 2,
                text: Some(ChartText::Rich(crate::domain::charts::parse_text_body(
                    br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:p><a:r><a:rPr i="1"/><a:t>Point Label</a:t></a:r></a:p>
                    </c:rich>"#,
                ))),
                position: Some(DataLabelPosition::Top),
                num_fmt: Some(ooxml_types::charts::NumFmt {
                    format_code: "0.00".to_string(),
                    source_linked: Some(false),
                }),
                ..Default::default()
            }],
            ..Default::default()
        };

        let extracted = extract_single_series(&series, None, None);
        let point = extracted
            .points
            .as_ref()
            .and_then(|points| points.first())
            .expect("point override");
        let label = point.data_label.as_ref().expect("data label override");

        assert_eq!(point.idx, 2);
        assert!(label.show);
        assert_eq!(label.text.as_deref(), Some("Point Label"));
        assert_eq!(label.position.as_deref(), Some("top"));
        assert_eq!(label.separator.as_deref(), Some("; "));
        assert_eq!(label.number_format.as_deref(), Some("0.00"));
        assert_eq!(label.link_number_format, Some(false));
        assert_eq!(label.rich_text.as_ref().map(Vec::len), Some(1));
    }

    #[test]
    fn defaults_series_name_from_ooxml_idx_when_text_is_missing() {
        let series = ooxml_types::charts::ChartSeries {
            idx: 2,
            order: 1,
            ..Default::default()
        };

        let extracted = extract_single_series(&series, None, None);

        assert_eq!(extracted.name.as_deref(), Some("Series 2"));
    }

    #[test]
    fn defaults_zero_idx_series_name_from_plot_order() {
        let series = ooxml_types::charts::ChartSeries {
            idx: 0,
            order: 3,
            ..Default::default()
        };

        let extracted = extract_single_series(&series, None, None);

        assert_eq!(extracted.name.as_deref(), Some("Series 4"));
    }
}

// Extract legend from ChartSpace.
