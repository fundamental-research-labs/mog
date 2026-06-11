use domain_types::chart::{
    ChartColorData, ChartLineData, ChartSeriesCategoryLevelsCacheData, ChartSeriesData,
    ChartSeriesDimensionSourceKindData, ChartSeriesPointCacheData, ChartSeriesXRoleData,
    ChartType as DomainChartType, ErrorBarData, ErrorBarSourceData, PointFormatData, TrendlineData,
    TrendlineLabelData,
};
use ooxml_types::charts::{
    self, CatDataSource, DataPointOverride, ErrorBarDirection, ErrorBarType, ErrorBars,
    ErrorValueType, Marker, MarkerStyle, NumData, NumDataSource, NumFmt, NumPoint, NumRef,
    SeriesTextSource, StrData, StrPoint, StrRef, Trendline, TrendlineLabel, TrendlineType,
};
use ooxml_types::drawings::{DrawingColor, DrawingFill, ShapeProperties, SolidFill};

use super::{
    elements::{build_chart_text_rich, build_data_label_override, build_data_labels},
    formatting::{build_drawing_color, build_outline, build_shape_properties, build_text_body},
};

// =============================================================================
// Series
// =============================================================================

pub(super) fn build_series(
    sd: &ChartSeriesData,
    fallback_chart_type: &DomainChartType,
    fallback_idx: u32,
    synthesize_modeled_defaults: bool,
) -> charts::ChartSeries {
    let effective_chart_type = sd.r#type.as_ref().unwrap_or(fallback_chart_type);
    let uses_xy = matches!(
        effective_chart_type,
        DomainChartType::Scatter | DomainChartType::Bubble
    );

    // Determine if this series uses scatter/bubble conventions based on data fields
    let has_x_val = sd.x_role == Some(ChartSeriesXRoleData::Quantitative)
        || sd.bubble_size.is_some()
        || (sd.categories.is_some() && sd.values.is_some() && uses_xy);

    // Series name → SeriesTextSource. Prefer the imported live reference so
    // round-tripping preserves c:tx/c:strRef when Excel omitted a string cache.
    let tx = build_series_text(sd);

    // Value data (val or y_val)
    let val_ref = build_num_data_source(
        sd.values.as_deref(),
        sd.value_cache.as_ref(),
        sd.value_source_kind,
    );
    let (val, y_val) = if has_x_val {
        (None, val_ref)
    } else {
        (val_ref, None)
    };

    // Category data (cat or x_val)
    let cat_ref = build_cat_data_source(
        sd.categories.as_deref(),
        sd.category_cache.as_ref(),
        sd.category_levels.as_ref(),
        sd.category_label_format.as_ref(),
        sd.category_source_kind,
        uses_xy,
    );
    let (cat, x_val) = if has_x_val {
        (None, cat_ref)
    } else {
        (cat_ref, None)
    };

    // Bubble size
    let bubble_size = build_num_data_source(
        sd.bubble_size.as_deref(),
        sd.bubble_size_cache.as_ref(),
        sd.bubble_size_source_kind,
    );

    // Marker
    let marker = build_marker(sd);

    // Data points
    let d_pt: Vec<DataPointOverride> = sd
        .points
        .as_ref()
        .map(|pts| pts.iter().map(build_data_point).collect())
        .unwrap_or_default();

    // Trendlines
    let trendline: Vec<Trendline> = sd
        .trendlines
        .as_ref()
        .map(|tls| tls.iter().map(build_trendline).collect())
        .unwrap_or_default();

    // Error bars
    let mut err_bars: Vec<ErrorBars> = Vec::new();
    if let Some(ref eb) = sd.error_bars {
        err_bars.push(build_error_bars(eb));
    }
    if let Some(ref eb) = sd.x_error_bars {
        err_bars.push(build_error_bars(eb));
    }
    if let Some(ref eb) = sd.y_error_bars {
        err_bars.push(build_error_bars(eb));
    }

    // Series-level and per-point data labels
    let mut d_lbls = sd.data_labels.as_ref().map(build_data_labels);
    let point_labels: Vec<_> = sd
        .points
        .as_ref()
        .map(|points| {
            points
                .iter()
                .filter_map(|point| {
                    point
                        .data_label
                        .as_ref()
                        .map(|label| build_data_label_override(point.idx, label))
                })
                .collect()
        })
        .unwrap_or_default();
    if !point_labels.is_empty() {
        d_lbls
            .get_or_insert_with(Default::default)
            .d_lbl
            .extend(point_labels);
    }

    // Shape properties from explicit format, legacy color, or modeled chart defaults.
    let sp_pr = sd
        .format
        .as_ref()
        .and_then(build_shape_properties)
        .or_else(|| build_legacy_series_color_shape_properties(sd, effective_chart_type))
        .or_else(|| {
            synthesize_modeled_defaults
                .then(|| default_series_shape_properties(sd, effective_chart_type, fallback_idx))
                .flatten()
        });

    // Bar shape
    let shape = sd.bar_shape.as_deref().map(charts::BarShape::from_ooxml);

    charts::ChartSeries {
        idx: sd.idx.unwrap_or(fallback_idx),
        order: sd.order.unwrap_or(fallback_idx),
        tx,
        sp_pr,
        cat,
        val,
        x_val,
        y_val,
        bubble_size,
        marker,
        smooth: sd.smooth,
        explosion: sd.explosion,
        invert_if_negative: sd.invert_if_negative,
        d_lbls,
        d_pt,
        trendline,
        err_bars,
        shape,
        ..Default::default()
    }
}

fn build_legacy_series_color_shape_properties(
    sd: &ChartSeriesData,
    chart_type: &DomainChartType,
) -> Option<ShapeProperties> {
    sd.color.as_ref().map(|hex| {
        if chart_type_uses_default_line(chart_type) || sd.show_lines == Some(true) {
            series_line_shape_properties(hex, sd.line_width)
        } else {
            series_fill_shape_properties(hex)
        }
    })
}

fn default_series_shape_properties(
    sd: &ChartSeriesData,
    chart_type: &DomainChartType,
    fallback_idx: u32,
) -> Option<ShapeProperties> {
    let color = EXCEL_ACCENT_PALETTE[fallback_idx as usize % EXCEL_ACCENT_PALETTE.len()];
    if chart_type_uses_default_fill(chart_type) {
        return Some(series_fill_shape_properties(color));
    }
    if chart_type_uses_default_line(chart_type) || sd.show_lines == Some(true) {
        return Some(series_line_shape_properties(color, sd.line_width));
    }
    None
}

const EXCEL_ACCENT_PALETTE: [&str; 6] =
    ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

fn chart_type_uses_default_fill(chart_type: &DomainChartType) -> bool {
    matches!(
        chart_type,
        DomainChartType::Bar
            | DomainChartType::Bar3D
            | DomainChartType::Column
            | DomainChartType::Column3D
            | DomainChartType::Area
            | DomainChartType::Area3D
            | DomainChartType::Pie
            | DomainChartType::Pie3D
            | DomainChartType::Doughnut
            | DomainChartType::OfPie
            | DomainChartType::Bubble
    )
}

fn chart_type_uses_default_line(chart_type: &DomainChartType) -> bool {
    matches!(
        chart_type,
        DomainChartType::Line
            | DomainChartType::Line3D
            | DomainChartType::Radar
            | DomainChartType::Stock
    )
}

fn series_fill_shape_properties(hex: &str) -> ShapeProperties {
    ShapeProperties {
        fill: Some(DrawingFill::Solid(SolidFill {
            color: DrawingColor::SrgbClr {
                val: hex.trim_start_matches('#').to_string(),
                transforms: Vec::new(),
            },
        })),
        ..Default::default()
    }
}

fn series_line_shape_properties(hex: &str, width: Option<f64>) -> ShapeProperties {
    ShapeProperties {
        ln: Some(build_outline(&ChartLineData {
            color: Some(ChartColorData::Hex(hex.to_string())),
            width: Some(width.unwrap_or(2.25)),
            dash_style: None,
            transparency: None,
            no_fill: None,
        })),
        ..Default::default()
    }
}

fn build_series_text(sd: &ChartSeriesData) -> Option<SeriesTextSource> {
    if let Some(name_ref) = sd
        .name_ref
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(SeriesTextSource::StrRef(StrRef {
            f: name_ref.to_string(),
            str_cache: sd.name.as_ref().map(|name| StrData {
                pt_count: Some(1),
                pts: vec![StrPoint {
                    idx: 0,
                    v: name.clone(),
                }],
                extensions: vec![],
            }),
            extensions: vec![],
        }));
    }
    sd.name
        .as_ref()
        .map(|name| SeriesTextSource::Value(name.clone()))
}

fn build_num_data_source(
    formula: Option<&str>,
    cache: Option<&ChartSeriesPointCacheData>,
    source_kind: Option<ChartSeriesDimensionSourceKindData>,
) -> Option<NumDataSource> {
    if source_kind == Some(ChartSeriesDimensionSourceKindData::Literal) {
        return cache
            .filter(|cache| point_cache_has_payload(cache))
            .map(num_data_from_cache)
            .map(NumDataSource::Lit);
    }

    if let Some(formula) = formula {
        return Some(NumDataSource::Ref(NumRef {
            f: formula.to_string(),
            num_cache: if source_kind == Some(ChartSeriesDimensionSourceKindData::CacheFallback) {
                cache
                    .filter(|cache| point_cache_has_payload(cache))
                    .map(num_data_from_cache)
            } else {
                None
            },
            ..Default::default()
        }));
    }

    if source_kind == Some(ChartSeriesDimensionSourceKindData::Ref) {
        return None;
    }

    cache
        .filter(|cache| point_cache_has_payload(cache))
        .map(num_data_from_cache)
        .map(NumDataSource::Lit)
}

fn build_cat_data_source(
    formula: Option<&str>,
    cache: Option<&ChartSeriesPointCacheData>,
    category_levels: Option<&ChartSeriesCategoryLevelsCacheData>,
    category_label_format: Option<&domain_types::chart::CategoryLabelFormatData>,
    source_kind: Option<ChartSeriesDimensionSourceKindData>,
    force_numeric: bool,
) -> Option<CatDataSource> {
    let numeric_category = force_numeric || category_cache_is_numeric(cache, category_label_format);

    if source_kind == Some(ChartSeriesDimensionSourceKindData::Literal) {
        return cache
            .filter(|cache| point_cache_has_payload(cache))
            .map(|cache| {
                if numeric_category {
                    CatDataSource::NumLit(num_data_from_category_cache(
                        cache,
                        category_label_format,
                    ))
                } else {
                    CatDataSource::StrLit(str_data_from_cache(cache))
                }
            });
    }

    if let Some(formula) = formula {
        if let Some(levels) = category_levels {
            return Some(CatDataSource::MultiLvlStrRef(charts::MultiLvlStrRef {
                f: formula.to_string(),
                multi_lvl_str_cache: (source_kind
                    == Some(ChartSeriesDimensionSourceKindData::CacheFallback)
                    && category_levels_cache_has_payload(levels))
                .then(|| multi_lvl_str_data_from_cache(levels)),
                ..Default::default()
            }));
        }
    }

    if let Some(formula) = formula {
        return if numeric_category {
            Some(CatDataSource::NumRef(NumRef {
                f: formula.to_string(),
                num_cache: if source_kind == Some(ChartSeriesDimensionSourceKindData::CacheFallback)
                {
                    cache
                        .filter(|cache| point_cache_has_payload(cache))
                        .map(|cache| num_data_from_category_cache(cache, category_label_format))
                } else {
                    None
                },
                ..Default::default()
            }))
        } else {
            Some(CatDataSource::StrRef(StrRef {
                f: formula.to_string(),
                str_cache: if source_kind == Some(ChartSeriesDimensionSourceKindData::CacheFallback)
                {
                    cache
                        .filter(|cache| point_cache_has_payload(cache))
                        .map(str_data_from_cache)
                } else {
                    None
                },
                ..Default::default()
            }))
        };
    }

    if source_kind == Some(ChartSeriesDimensionSourceKindData::Ref) {
        return None;
    }

    cache
        .filter(|cache| point_cache_has_payload(cache))
        .map(|cache| {
            if numeric_category {
                CatDataSource::NumLit(num_data_from_category_cache(cache, category_label_format))
            } else {
                CatDataSource::StrLit(str_data_from_cache(cache))
            }
        })
}

fn point_cache_has_payload(cache: &ChartSeriesPointCacheData) -> bool {
    cache.point_count.is_some() || cache.format_code.is_some() || !cache.points.is_empty()
}

fn category_levels_cache_has_payload(cache: &ChartSeriesCategoryLevelsCacheData) -> bool {
    cache.point_count.is_some()
        || cache
            .levels
            .iter()
            .any(|level| level.point_count.is_some() || !level.points.is_empty())
}

fn multi_lvl_str_data_from_cache(
    cache: &ChartSeriesCategoryLevelsCacheData,
) -> charts::MultiLvlStrData {
    charts::MultiLvlStrData {
        pt_count: cache.point_count,
        levels: cache
            .levels
            .iter()
            .map(|level| StrData {
                pt_count: level.point_count,
                pts: level
                    .points
                    .iter()
                    .map(|point| StrPoint {
                        idx: point.idx,
                        v: point.value.clone(),
                    })
                    .collect(),
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    }
}

fn num_data_from_cache(cache: &ChartSeriesPointCacheData) -> NumData {
    NumData {
        format_code: cache.format_code.clone(),
        pt_count: cache.point_count,
        pts: cache
            .points
            .iter()
            .map(|point| NumPoint {
                idx: point.idx,
                v: point.value.clone(),
                format_code: point.format_code.clone(),
            })
            .collect(),
        ..Default::default()
    }
}

fn category_cache_is_numeric(
    cache: Option<&ChartSeriesPointCacheData>,
    category_label_format: Option<&domain_types::chart::CategoryLabelFormatData>,
) -> bool {
    category_label_format.is_some()
        || cache.is_some_and(|cache| {
            cache.format_code.is_some()
                || cache.points.iter().any(|point| point.format_code.is_some())
        })
}

fn num_data_from_category_cache(
    cache: &ChartSeriesPointCacheData,
    category_label_format: Option<&domain_types::chart::CategoryLabelFormatData>,
) -> NumData {
    let mut data = num_data_from_cache(cache);
    if let Some(format) = category_label_format {
        data.format_code = format.format_code.clone().or(data.format_code);
        if let Some(points) = format.points.as_ref() {
            for point in &mut data.pts {
                if let Some(format_point) = points.iter().find(|format_point| {
                    format_point.idx == point.idx && format_point.format_code.is_some()
                }) {
                    point.format_code = format_point
                        .format_code
                        .clone()
                        .or(point.format_code.clone());
                }
            }
        }
    }
    data
}

fn str_data_from_cache(cache: &ChartSeriesPointCacheData) -> StrData {
    StrData {
        pt_count: cache.point_count,
        pts: cache
            .points
            .iter()
            .map(|point| StrPoint {
                idx: point.idx,
                v: point.value.clone(),
            })
            .collect(),
        ..Default::default()
    }
}

pub(super) fn build_marker(sd: &ChartSeriesData) -> Option<Marker> {
    // Only build marker if there's marker info
    if sd.show_markers.is_none()
        && sd.marker_size.is_none()
        && sd.marker_style.is_none()
        && sd.marker_background_color.is_none()
        && sd.marker_foreground_color.is_none()
    {
        return None;
    }

    let symbol = sd
        .marker_style
        .as_deref()
        .map(MarkerStyle::from_ooxml)
        .or_else(|| {
            sd.show_markers.map(|show| {
                if show {
                    MarkerStyle::Auto
                } else {
                    MarkerStyle::None
                }
            })
        });

    Some(Marker {
        symbol,
        size: sd.marker_size,
        sp_pr: build_marker_shape_properties(
            sd.marker_background_color.as_ref(),
            sd.marker_foreground_color.as_ref(),
        ),
        ..Default::default()
    })
}

pub(super) fn build_data_point(pt: &PointFormatData) -> DataPointOverride {
    let sp_pr = pt
        .visual_format
        .as_ref()
        .and_then(build_shape_properties)
        .or_else(|| {
            pt.line_format.as_ref().map(|line| ShapeProperties {
                ln: Some(build_outline(line)),
                ..Default::default()
            })
        })
        .or_else(|| {
            // Legacy: simple fill color string
            pt.fill.as_ref().map(|hex| ShapeProperties {
                fill: Some(DrawingFill::Solid(SolidFill {
                    color: DrawingColor::SrgbClr {
                        val: hex.trim_start_matches('#').to_string(),
                        transforms: Vec::new(),
                    },
                })),
                ..Default::default()
            })
        });

    DataPointOverride {
        idx: pt.idx,
        invert_if_negative: pt.invert_if_negative,
        marker: build_point_marker(pt),
        bubble_3d: pt.bubble_3d,
        explosion: pt.explosion,
        sp_pr,
        ..Default::default()
    }
}

fn build_point_marker(pt: &PointFormatData) -> Option<Marker> {
    if pt.marker_size.is_none()
        && pt.marker_style.is_none()
        && pt.marker_background_color.is_none()
        && pt.marker_foreground_color.is_none()
    {
        return None;
    }

    Some(Marker {
        symbol: pt.marker_style.as_deref().map(MarkerStyle::from_ooxml),
        size: pt.marker_size,
        sp_pr: build_marker_shape_properties(
            pt.marker_background_color.as_ref(),
            pt.marker_foreground_color.as_ref(),
        ),
        ..Default::default()
    })
}

fn build_marker_shape_properties(
    fill: Option<&domain_types::chart::ChartColorData>,
    line: Option<&domain_types::chart::ChartColorData>,
) -> Option<ShapeProperties> {
    if fill.is_none() && line.is_none() {
        return None;
    }

    Some(ShapeProperties {
        fill: fill.map(|color| {
            DrawingFill::Solid(SolidFill {
                color: build_drawing_color(color),
            })
        }),
        ln: line.map(|color| {
            build_outline(&domain_types::chart::ChartLineData {
                color: Some(color.clone()),
                width: None,
                dash_style: None,
                transparency: None,
                no_fill: None,
            })
        }),
        ..Default::default()
    })
}

// =============================================================================
// Trendlines
// =============================================================================

pub(super) fn build_trendline(td: &TrendlineData) -> Trendline {
    let trendline_type = td
        .r#type
        .as_deref()
        .map(TrendlineType::from_ooxml)
        .unwrap_or_default();

    let sp_pr = td.line_format.as_ref().map(|lf| ShapeProperties {
        ln: Some(build_outline(lf)),
        ..Default::default()
    });

    let trendline_lbl = td.label.as_ref().map(build_trendline_label);

    Trendline {
        name: td.name.clone(),
        sp_pr,
        trendline_type,
        order: td.order,
        period: td.period,
        forward: td.forward,
        backward: td.backward,
        intercept: td.intercept,
        disp_r_sqr: td.display_r_squared,
        disp_eq: td.display_equation,
        trendline_lbl,
        ..Default::default()
    }
}

pub(super) fn build_trendline_label(tll: &TrendlineLabelData) -> TrendlineLabel {
    let tx = tll.text.as_ref().map(|t| build_chart_text_rich(t, None));
    let num_fmt = tll.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: Some(false),
    });
    let sp_pr = tll.format.as_ref().and_then(build_shape_properties);
    let tx_pr = tll.format.as_ref().and_then(build_text_body);

    TrendlineLabel {
        layout: tll.layout.clone().map(Into::into),
        tx,
        num_fmt,
        sp_pr,
        tx_pr,
        ..Default::default()
    }
}

// =============================================================================
// Error Bars
// =============================================================================

pub(super) fn build_error_bars(eb: &ErrorBarData) -> ErrorBars {
    let err_dir = eb.direction.as_deref().map(ErrorBarDirection::from_ooxml);
    let err_bar_type = eb
        .bar_type
        .as_deref()
        .map(ErrorBarType::from_ooxml)
        .unwrap_or_default();
    let err_val_type = eb
        .value_type
        .as_deref()
        .map(ErrorValueType::from_ooxml)
        .unwrap_or_default();

    let sp_pr = eb.line_format.as_ref().map(|lf| ShapeProperties {
        ln: Some(build_outline(lf)),
        ..Default::default()
    });

    ErrorBars {
        err_dir,
        err_bar_type,
        err_val_type,
        no_end_cap: eb.no_end_cap,
        val: eb.value,
        sp_pr,
        plus: eb.plus_source.as_ref().map(build_error_bar_source),
        minus: eb.minus_source.as_ref().map(build_error_bar_source),
        ..Default::default()
    }
}

fn build_error_bar_source(source: &ErrorBarSourceData) -> NumDataSource {
    let cache = source.cache.as_ref().map(build_num_data_from_point_cache);
    if let Some(formula) = source.formula.as_ref() {
        NumDataSource::Ref(NumRef {
            f: formula.clone(),
            num_cache: cache,
            ..Default::default()
        })
    } else {
        NumDataSource::Lit(cache.unwrap_or_default())
    }
}

fn build_num_data_from_point_cache(cache: &ChartSeriesPointCacheData) -> NumData {
    NumData {
        format_code: cache.format_code.clone(),
        pt_count: cache.point_count,
        pts: cache
            .points
            .iter()
            .map(|point| NumPoint {
                idx: point.idx,
                v: point.value.clone(),
                format_code: point.format_code.clone(),
            })
            .collect(),
        extensions: Vec::new(),
    }
}
